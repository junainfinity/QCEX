package com.qcex.ledger;

import com.qcex.core.Amounts;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.util.*;

@Service
public class Ledger {
    public record Leg(String owner, String wallet, String asset, String bucket, BigDecimal amount) {}
    private final JdbcTemplate db;
    public Ledger(JdbcTemplate db) { this.db = db; }
    public void lock() { db.queryForObject("SELECT id FROM command_lock WHERE id=1 FOR UPDATE", Integer.class); }
    public BigDecimal balance(String owner, String wallet, String asset, String bucket) {
        if (!Set.of("available", "held").contains(bucket)) throw new IllegalArgumentException("Unknown bucket");
        var rows = db.queryForList("SELECT " + bucket + " AS amount FROM balances WHERE owner_id=? AND wallet=? AND asset=?", owner, wallet, asset);
        return rows.isEmpty() ? Amounts.ZERO : (BigDecimal) rows.getFirst().get("amount");
    }
    public static void verifyBalanced(List<Leg> legs) {
        var sums = new HashMap<String, BigDecimal>();
        for (var l : legs) {
            if (!Set.of("available", "held").contains(l.bucket())) throw new IllegalArgumentException("Unknown bucket");
            l.amount().setScale(8, java.math.RoundingMode.UNNECESSARY);
            sums.merge(l.asset(), l.amount(), BigDecimal::add);
        }
        if (legs.size() < 2 || sums.values().stream().anyMatch(v -> v.signum()!=0)) throw new IllegalStateException("Unbalanced journal");
    }
    /** Caller holds the command lock inside an ACID transaction. Aggregate first, then enforce spend limits. */
    public void post(String reference, String kind, List<Leg> legs) {
        verifyBalanced(legs);
        db.update("INSERT INTO journal(reference_id,kind) VALUES (?,?)", reference, kind);
        long id = db.queryForObject("SELECT id FROM journal WHERE reference_id=?", Long.class, reference);
        var net = new LinkedHashMap<String, BigDecimal>();
        for (var l : legs) net.merge(String.join("|", l.owner(), l.wallet(), l.asset(), l.bucket()), l.amount(), BigDecimal::add);
        for (var e : net.entrySet()) {
            String[] k = e.getKey().split("\\|");
            db.update("INSERT IGNORE INTO balances(owner_id,wallet,asset) VALUES (?,?,?)", k[0], k[1], k[2]);
            db.update("UPDATE balances SET " + k[3] + "=" + k[3] + "+? WHERE owner_id=? AND wallet=? AND asset=?", e.getValue(), k[0], k[1], k[2]);
            if (!k[0].equals("faucet") && balance(k[0],k[1],k[2],k[3]).signum()<0) throw new IllegalArgumentException("Insufficient available " + k[2]);
        }
        for (var l : legs) if (l.amount().signum()!=0)
            db.update("INSERT INTO postings(journal_id,owner_id,wallet,asset,bucket,amount) VALUES (?,?,?,?,?,?)", id,l.owner(),l.wallet(),l.asset(),l.bucket(),l.amount());
    }
    public void move(String reference, String kind, String owner, String fromWallet, String fromBucket, String toWallet, String toBucket, String asset, BigDecimal amount) {
        post(reference,kind,List.of(new Leg(owner,fromWallet,asset,fromBucket,amount.negate()),new Leg(owner,toWallet,asset,toBucket,amount)));
    }
    public void fund(String owner, String asset, BigDecimal amount) {
        post("fund:"+owner+":"+asset,"SANDBOX_CREDIT", List.of(new Leg("faucet","SYSTEM",asset,"available",amount.negate()),new Leg(owner,"SPOT",asset,"available",amount)));
    }
    public Map<String,Object> reconcile() {
        var imbalance = db.queryForList("SELECT journal_id,asset,SUM(amount) difference FROM postings GROUP BY journal_id,asset HAVING SUM(amount)<>0");
        var negatives = db.queryForList("SELECT owner_id,asset FROM balances WHERE owner_id<>'faucet' AND (available<0 OR held<0)");
        var mismatches = db.queryForList("SELECT b.owner_id,b.wallet,b.asset FROM balances b LEFT JOIN (SELECT owner_id,wallet,asset,SUM(CASE WHEN bucket='available' THEN amount ELSE 0 END) a,SUM(CASE WHEN bucket='held' THEN amount ELSE 0 END) h FROM postings GROUP BY owner_id,wallet,asset) p ON b.owner_id=p.owner_id AND b.wallet=p.wallet AND b.asset=p.asset WHERE b.available<>COALESCE(p.a,0) OR b.held<>COALESCE(p.h,0)");
        var orderHolds = db.queryForList("SELECT b.owner_id,b.asset FROM balances b LEFT JOIN (SELECT o.owner_id,CASE WHEN o.side='BUY' THEN i.quote_asset ELSE i.base_asset END asset,SUM(o.hold_amount) h FROM orders o JOIN instruments i ON o.symbol=i.symbol GROUP BY o.owner_id,asset) p ON b.owner_id=p.owner_id AND b.asset=p.asset WHERE b.wallet='SPOT' AND b.held<>COALESCE(p.h,0)");
        var earnHolds = db.queryForList("SELECT b.owner_id,b.asset FROM balances b LEFT JOIN (SELECT owner_id,asset,SUM(principal) h FROM subscriptions WHERE state='ACTIVE' GROUP BY owner_id,asset) p ON b.owner_id=p.owner_id AND b.asset=p.asset WHERE b.wallet='EARN' AND b.held<>COALESCE(p.h,0)");
        int holdMismatches=orderHolds.size()+earnHolds.size();
        return Map.of("balanced",imbalance.isEmpty() && negatives.isEmpty() && mismatches.isEmpty() && holdMismatches==0,"imbalancedJournals",imbalance.size(),"negativeBalances",negatives.size(),"projectionMismatches",mismatches.size(),"holdMismatches",holdMismatches,"journalCount",db.queryForObject("SELECT COUNT(*) FROM journal",Long.class));
    }
}
