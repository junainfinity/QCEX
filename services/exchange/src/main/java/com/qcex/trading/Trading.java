package com.qcex.trading;

import com.qcex.core.Amounts;
import com.qcex.identity.Identity;
import com.qcex.ledger.Ledger;
import com.qcex.ledger.Ledger.Leg;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.util.*;

@Service
public class Trading {
    public record OrderRequest(String commandId,String symbol,String side,String type,String timeInForce,Object price,Object quantity) {
        public OrderRequest { requireDecimalString(price);requireDecimalString(quantity); }
    }
    public record TransferRequest(String commandId,String asset,Object amount,String from,String to) {
        public TransferRequest { requireDecimalString(amount); }
    }
    public record EarnRequest(String commandId,String asset,Object amount) {
        public EarnRequest { requireDecimalString(amount); }
    }
    private static void requireDecimalString(Object value) {if(!(value instanceof String))throw new IllegalArgumentException("Financial amounts must be JSON strings");}
    private final JdbcTemplate db;
    private final Ledger ledger;
    public Trading(JdbcTemplate db,Ledger ledger) {this.db=db;this.ledger=ledger;}
    private static BigDecimal decimal(Map<String,Object> row,String key) {return (BigDecimal)row.get(key);}
    private static String string(Map<String,Object> row,String key) {return (String)row.get(key);}
    private void validKey(String key) {if(key==null || !key.matches("[a-zA-Z0-9_-]{8,64}")) throw new IllegalArgumentException("A stable 8–64 character command ID is required");}
    private String previous(String owner,String key,String fingerprint) {
        validKey(key);
        var rows=db.queryForList("SELECT * FROM commands WHERE owner_id=? AND command_id=?",owner,key);
        if(rows.isEmpty())return null;
        if(!rows.getFirst().get("fingerprint").equals(fingerprint))throw new Conflict("Command ID was already used for another request");
        return string(rows.getFirst(),"result_id");
    }
    private void remember(String owner,String key,String fingerprint,String result) {db.update("INSERT INTO commands VALUES (?,?,?,?)",owner,key,fingerprint,result);}
    public Map<String,Object> instrument(String symbol) {
        var rows=db.queryForList("SELECT * FROM instruments WHERE symbol=? AND state='TRADING'",symbol);
        if(rows.isEmpty())throw new IllegalArgumentException("Unsupported or halted instrument");return rows.getFirst();
    }
    private Map<String,Object> order(String id) {return db.queryForMap("SELECT * FROM orders WHERE id=?",id);}
    private static BigDecimal buyHold(BigDecimal price,BigDecimal quantity,BigDecimal step) {
        // At most quantity/step fills. This bound covers upward fee rounding on every partial fill.
        var notional=Amounts.quote(price,quantity);
        return notional.add(Amounts.fee(notional)).add(quantity.divide(step).multiply(new BigDecimal("0.00000001")));
    }
    @Transactional
    public Map<String,Object> submit(String owner,OrderRequest request) {
        ledger.lock();
        if(request==null || !Set.of("BUY","SELL").contains(Objects.toString(request.side(),"")) || !Set.of("LIMIT","MARKET").contains(Objects.toString(request.type(),"")) || !Set.of("GTC","IOC","FOK","POST").contains(Objects.toString(request.timeInForce(),"")))
            throw new IllegalArgumentException("Unsupported side, order type or time in force");
        if(request.type().equals("MARKET") && !request.timeInForce().equals("IOC"))throw new IllegalArgumentException("Protected market orders require IOC");
        var price=Amounts.parse((String)request.price());var quantity=Amounts.parse((String)request.quantity());
        String fingerprint=Identity.hash(String.join("|","ORDER",request.symbol(),request.side(),request.type(),request.timeInForce(),Amounts.text(price),Amounts.text(quantity)));
        String existing=previous(owner,request.commandId(),fingerprint);if(existing!=null)return order(existing);
        var market=instrument(request.symbol());String base=string(market,"base_asset"),quote=string(market,"quote_asset");
        if(price.remainder(decimal(market,"price_tick")).signum()!=0 || quantity.remainder(decimal(market,"quantity_step")).signum()!=0)throw new IllegalArgumentException("Price or quantity violates instrument increments");
        var notional=Amounts.quote(price,quantity);
        if(notional.compareTo(decimal(market,"min_notional"))<0 || notional.compareTo(new BigDecimal("10000000"))>0)throw new IllegalArgumentException("Order notional must be between 5 and 10,000,000 USDT");
        if(db.queryForObject("SELECT COUNT(*) FROM orders WHERE owner_id=? AND state IN ('NEW','PARTIALLY_FILLED')",Long.class,owner)>=200)throw new IllegalArgumentException("Open order limit reached");
        boolean buy=request.side().equals("BUY");
        var makers=db.queryForList("SELECT * FROM orders WHERE symbol=? AND side=? AND owner_id<>? AND state IN ('NEW','PARTIALLY_FILLED') AND price"+(buy?"<=":" >=")+"? ORDER BY price "+(buy?"ASC":"DESC")+",sequence_id ASC",request.symbol(),buy?"SELL":"BUY",owner,price);
        if(request.timeInForce().equals("POST") && !makers.isEmpty())throw new IllegalArgumentException("Post-only order would take liquidity");
        if(request.timeInForce().equals("FOK") && makers.stream().map(m->decimal(m,"remaining")).reduce(Amounts.ZERO,BigDecimal::add).compareTo(quantity)<0)throw new IllegalArgumentException("FOK requires full executable liquidity");
        String id=UUID.randomUUID().toString();
        BigDecimal hold=buy?buyHold(price,quantity,decimal(market,"quantity_step")):quantity;
        ledger.move("reserve:"+id,"RESERVE",owner,"SPOT","available","SPOT","held",buy?quote:base,hold);
        db.update("INSERT INTO orders(id,owner_id,symbol,side,order_type,time_in_force,price,quantity,remaining,hold_amount,state,rule_version) VALUES (?,?,?,?,?,?,?,?,?,?,'NEW',?)",id,owner,request.symbol(),request.side(),request.type(),request.timeInForce(),price,quantity,quantity,hold,market.get("rule_version"));
        BigDecimal remaining=quantity;
        for(var maker:makers) {
            if(remaining.signum()==0)break;
            BigDecimal amount=remaining.min(decimal(maker,"remaining")),executionPrice=decimal(maker,"price"),cost=Amounts.quote(executionPrice,amount),fee=Amounts.fee(cost);
            String makerId=string(maker,"id"),makerOwner=string(maker,"owner_id"),buyer=buy?owner:makerOwner,seller=buy?makerOwner:owner;
            String fillRef="fill:"+id+":"+makerId;
            ledger.post(fillRef,"TRADE",List.of(
                new Leg(buyer,"SPOT",quote,"held",cost.add(fee).negate()),new Leg(seller,"SPOT",quote,"available",cost.subtract(fee)),new Leg("fees","SYSTEM",quote,"available",fee.multiply(new BigDecimal("2"))),
                new Leg(seller,"SPOT",base,"held",amount.negate()),new Leg(buyer,"SPOT",base,"available",amount)));
            db.update("INSERT INTO fills(symbol,maker_order,taker_order,buyer,seller,price,quantity,quote_amount,buyer_fee,seller_fee) VALUES (?,?,?,?,?,?,?,?,?,?)",request.symbol(),makerId,id,buyer,seller,executionPrice,amount,cost,fee,fee);
            remaining=remaining.subtract(amount);hold=hold.subtract(buy?cost.add(fee):amount);
            BigDecimal makerRemaining=decimal(maker,"remaining").subtract(amount),makerHold=decimal(maker,"hold_amount").subtract(buy?amount:cost.add(fee));
            if(makerRemaining.signum()==0 && makerHold.signum()>0) {
                ledger.move("release:"+makerId,"RELEASE",makerOwner,"SPOT","held","SPOT","available",buy?base:quote,makerHold);makerHold=Amounts.ZERO;
            }
            db.update("UPDATE orders SET remaining=?,hold_amount=?,state=? WHERE id=?",makerRemaining,makerHold,makerRemaining.signum()==0?"FILLED":"PARTIALLY_FILLED",makerId);
        }
        String state=remaining.signum()==0?"FILLED":remaining.compareTo(quantity)<0?"PARTIALLY_FILLED":"NEW";
        if(remaining.signum()==0 || request.timeInForce().equals("IOC")) {
            if(hold.signum()>0)ledger.move("release:"+id,"RELEASE",owner,"SPOT","held","SPOT","available",buy?quote:base,hold);
            hold=Amounts.ZERO;
            if(remaining.signum()>0)state="EXPIRED";
        }
        db.update("UPDATE orders SET remaining=?,hold_amount=?,state=? WHERE id=?",remaining,hold,state,id);
        remember(owner,request.commandId(),fingerprint,id);
        db.update("INSERT INTO outbox(event_type,aggregate_id,payload) VALUES ('ORDER_COMMITTED',?,?)",id,"{\"state\":\""+state+"\"}");
        return order(id);
    }
    @Transactional
    public Map<String,Object> cancel(String owner,String id) {
        ledger.lock();var rows=db.queryForList("SELECT * FROM orders WHERE id=? AND owner_id=?",id,owner);
        if(rows.isEmpty())throw new IllegalArgumentException("Order not found");var row=rows.getFirst();
        if(Set.of("NEW","PARTIALLY_FILLED").contains(string(row,"state"))) {
            // Trading eligibility must never prevent releasing an existing order's hold.
            var market=db.queryForMap("SELECT base_asset,quote_asset FROM instruments WHERE symbol=?",string(row,"symbol"));
            String asset=string(row,"side").equals("BUY")?string(market,"quote_asset"):string(market,"base_asset");
            ledger.move("release:"+id,"CANCEL",owner,"SPOT","held","SPOT","available",asset,decimal(row,"hold_amount"));
            db.update("UPDATE orders SET hold_amount=0,state='CANCELED' WHERE id=?",id);
            db.update("INSERT INTO outbox(event_type,aggregate_id,payload) VALUES ('ORDER_CANCELED',?,'{}')",id);
        }return order(id);
    }
    @Transactional
    public Map<String,Object> transfer(String owner,TransferRequest r) {
        ledger.lock();
        if(!Set.of("SPOT","FUNDING").contains(Objects.toString(r.from(),"")) || !Set.of("SPOT","FUNDING").contains(Objects.toString(r.to(),"")) || r.from().equals(r.to()))throw new IllegalArgumentException("Select different Spot and Funding wallets");
        asset(r.asset());var amount=Amounts.parse((String)r.amount());String fingerprint=Identity.hash("TRANSFER|"+r.asset()+"|"+Amounts.text(amount)+"|"+r.from()+"|"+r.to());
        String previous=previous(owner,r.commandId(),fingerprint);if(previous!=null)return Map.of("id",previous,"status","COMPLETED");
        String id=UUID.randomUUID().toString();ledger.move("transfer:"+id,"TRANSFER",owner,r.from(),"available",r.to(),"available",r.asset(),amount);remember(owner,r.commandId(),fingerprint,id);return Map.of("id",id,"status","COMPLETED");
    }
    private void asset(String asset) {if(!Set.of("USDT","BTC","ETH","SOL").contains(Objects.toString(asset,"")))throw new IllegalArgumentException("Unsupported asset");}
    @Transactional
    public Map<String,Object> subscribe(String owner,EarnRequest r) {
        ledger.lock();asset(r.asset());var amount=Amounts.parse((String)r.amount());String fingerprint=Identity.hash("EARN|"+r.asset()+"|"+Amounts.text(amount));
        String previous=previous(owner,r.commandId(),fingerprint);if(previous!=null)return db.queryForMap("SELECT * FROM subscriptions WHERE id=?",previous);
        String id=UUID.randomUUID().toString();ledger.move("subscribe:"+id,"SUBSCRIBE",owner,"SPOT","available","EARN","held",r.asset(),amount);
        db.update("INSERT INTO subscriptions(id,owner_id,asset,product,principal,state) VALUES (?,?,?,'FLEXIBLE',?,'ACTIVE')",id,owner,r.asset(),amount);remember(owner,r.commandId(),fingerprint,id);return db.queryForMap("SELECT * FROM subscriptions WHERE id=?",id);
    }
    @Transactional
    public Map<String,Object> redeem(String owner,String id) {
        ledger.lock();var rows=db.queryForList("SELECT * FROM subscriptions WHERE id=? AND owner_id=?",id,owner);if(rows.isEmpty())throw new IllegalArgumentException("Subscription not found");var row=rows.getFirst();
        if(row.get("state").equals("ACTIVE")) {
            ledger.move("redeem:"+id,"REDEEM",owner,"EARN","held","SPOT","available",string(row,"asset"),decimal(row,"principal"));db.update("UPDATE subscriptions SET state='REDEEMED' WHERE id=?",id);
        }return db.queryForMap("SELECT * FROM subscriptions WHERE id=?",id);
    }
    public static class Conflict extends RuntimeException { public Conflict(String message){super(message);} }
}
