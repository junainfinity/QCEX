package com.qcex.api;

import com.qcex.core.Amounts;
import com.qcex.identity.Identity;
import com.qcex.ledger.Ledger;
import com.qcex.trading.Trading;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.*;

/** Local ledger simulation only. Never constructs or broadcasts blockchain transactions. */
@RestController
@RequestMapping("/api/wallet")
public class WalletApi {
    private final JdbcTemplate db; private final Identity identity; private final Ledger ledger;
    private static final Map<String,String> PRICES=Map.of("USDT","1","BTC","65000","ETH","3200","SOL","150");
    private static final Map<String,String> LIMITS=Map.of("USDT","100000","BTC","1","ETH","20","SOL","1000");
    public WalletApi(JdbcTemplate db,Identity identity,Ledger ledger){this.db=db;this.identity=identity;this.ledger=ledger;}
    public record Movement(String commandId,String asset,Object amount,String network,String address,String demoCode) {}
    @GetMapping @Transactional(readOnly=true)
    public Object overview(@CookieValue(name="lc_session",required=false)String token) {
        String owner=identity.require(token); var assets=new ArrayList<Map<String,Object>>();
        BigDecimal total=Amounts.ZERO,held=Amounts.ZERO;
        for(String asset:List.of("USDT","BTC","ETH","SOL")) {
            var row=db.queryForMap("SELECT COALESCE(SUM(available+held),0) total,COALESCE(SUM(held),0) held FROM balances WHERE owner_id=? AND asset=?",owner,asset);
            var quantity=(BigDecimal)row.get("total");var reserved=(BigDecimal)row.get("held");var price=new BigDecimal(PRICES.get(asset));
            var value=quantity.multiply(price); total=total.add(value);held=held.add(reserved.multiply(price));
            assets.add(Map.of("asset",asset,"total",quantity,"spotAvailable",ledger.balance(owner,"SPOT",asset,"available"),"held",reserved,"snapshotPrice",price,"usdValue",value,"address","QCEX-SIM-"+asset+"-"+owner,"limit",LIMITS.get(asset)));
        }
        return Api.wire(Map.of("totalUsd",total,"heldUsd",held,"valuation","Fixed demo snapshot: USDT $1, BTC $65,000, ETH $3,200, SOL $150; not live market prices.","assets",assets,"movements",db.queryForList("SELECT * FROM wallet_movements WHERE owner_id=? ORDER BY created_at DESC LIMIT 50",owner)));
    }
    @PostMapping(value="/{kind}",consumes="application/json") @Transactional
    public Object move(@CookieValue(name="lc_session",required=false)String token,@PathVariable String kind,@RequestBody Movement r) {
        // Acquire the writer lock before any consistent read establishes a MySQL snapshot.
        ledger.lock();
        String owner=identity.require(token);
        if(!Set.of("deposit","withdraw").contains(kind))throw new IllegalArgumentException("Unknown wallet action");
        if(r.commandId()==null || !r.commandId().matches("[a-zA-Z0-9_-]{8,64}"))throw new IllegalArgumentException("Stable command ID required");
        if(r.asset()==null || !PRICES.containsKey(r.asset()) || !"QCEX-SIM".equals(r.network()))throw new IllegalArgumentException("Choose a supported asset and QCEX simulation network");
        if(!(r.amount() instanceof String))throw new IllegalArgumentException("Financial amounts must be JSON strings");
        BigDecimal amount=Amounts.parse((String)r.amount());
        if(amount.compareTo(new BigDecimal(LIMITS.get(r.asset())))>0)throw new IllegalArgumentException("Amount exceeds the per-operation simulation limit");
        String address="QCEX-SIM-"+r.asset()+"-"+owner;
        if(kind.equals("withdraw")) {
            if(!"123456".equals(r.demoCode()))throw new IllegalArgumentException("Use demo verification code 123456");
            if(r.address()==null || !r.address().matches("QCEX-SIM-"+r.asset()+"-[a-zA-Z0-9-]{3,64}"))throw new IllegalArgumentException("Only a matching QCEX-SIM demo destination is accepted");
            address=r.address();
        }
        String fingerprint=Identity.hash(kind+"|"+r.asset()+"|"+Amounts.text(amount)+"|"+r.network()+"|"+address);
        var previous=db.queryForList("SELECT fingerprint,result_id FROM commands WHERE owner_id=? AND command_id=?",owner,r.commandId());
        if(!previous.isEmpty()) {
            if(!fingerprint.equals(previous.getFirst().get("fingerprint")))throw new Trading.Conflict("Command ID was already used for another request");
            return Api.wire(db.queryForMap("SELECT * FROM wallet_movements WHERE id=? AND owner_id=?",previous.getFirst().get("result_id"),owner));
        }
        String id=UUID.randomUUID().toString(); boolean deposit=kind.equals("deposit");
        BigDecimal delta=deposit?amount:amount.negate();
        ledger.post("wallet:"+id,deposit?"DEMO_DEPOSIT":"DEMO_WITHDRAWAL",List.of(new Ledger.Leg(owner,"SPOT",r.asset(),"available",delta),new Ledger.Leg("faucet","SYSTEM",r.asset(),"available",delta.negate())));
        db.update("INSERT INTO wallet_movements(id,owner_id,asset,kind,amount,network,address,state) VALUES (?,?,?,?,?,?,?,'SIMULATED_COMPLETED')",id,owner,r.asset(),kind.toUpperCase(Locale.ROOT),amount,r.network(),address);
        db.update("INSERT INTO commands(owner_id,command_id,fingerprint,result_id) VALUES (?,?,?,?)",owner,r.commandId(),fingerprint,id);
        return Api.wire(db.queryForMap("SELECT * FROM wallet_movements WHERE id=?",id));
    }
    @ExceptionHandler(Identity.Unauthorized.class) @ResponseStatus(org.springframework.http.HttpStatus.UNAUTHORIZED)
    public Object unauthorized(){return Map.of("error","Sign in to continue");}
    @ExceptionHandler(Trading.Conflict.class) @ResponseStatus(org.springframework.http.HttpStatus.CONFLICT)
    public Object conflict(Trading.Conflict e){return Map.of("error",e.getMessage());}
    @ExceptionHandler({IllegalArgumentException.class,ArithmeticException.class}) @ResponseStatus(org.springframework.http.HttpStatus.BAD_REQUEST)
    public Object invalid(RuntimeException e){return Map.of("error",e.getMessage());}
}
