package com.qcex.trading;

import com.qcex.ExchangeApplication;
import com.qcex.ledger.Ledger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import java.math.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(classes=ExchangeApplication.class,webEnvironment=SpringBootTest.WebEnvironment.NONE,properties={"spring.datasource.url=jdbc:mysql://127.0.0.1:3308/qcex_test"})
@EnabledIfEnvironmentVariable(named="QCEX_MYSQL_TESTS",matches="true")
class ExchangeDatabaseTest {
    @Autowired JdbcTemplate db; @Autowired Trading trading; @Autowired Ledger ledger; @Autowired TransactionTemplate tx;
    static final BigInteger SCALE=BigInteger.valueOf(100_000_000);
    static class RefOrder {
        String owner,id;boolean buy;long price,remaining,sequence;
        RefOrder(String owner,boolean buy,long price,long remaining,long sequence){this.owner=owner;this.buy=buy;this.price=price;this.remaining=remaining;this.sequence=sequence;}
    }
    @Test void seededSqlMatchingAgreesWithIndependentListAndIntegerModel() {
        tx.executeWithoutResult(status->{
            ledger.lock();
            String suffix=UUID.randomUUID().toString().substring(0,6),symbol="T"+suffix+"USDT",asset="T"+suffix;
            db.update("INSERT INTO instruments VALUES (?,?, 'USDT',100,1,1,5,1,'TRADING')",symbol,asset);
            String[] owners={"qa1"+suffix,"qa2"+suffix,"qa3"+suffix};
            Map<String,BigInteger> quote=new HashMap<>(),base=new HashMap<>();
            for(String owner:owners){ledger.fund(owner,"USDT",new BigDecimal("1000000"));ledger.fund(owner,asset,new BigDecimal("10000"));quote.put(owner,SCALE.multiply(BigInteger.valueOf(1000000)));base.put(owner,SCALE.multiply(BigInteger.valueOf(10000)));}
            List<RefOrder> reference=new ArrayList<>();Random random=new Random(64132026);BigInteger fees=BigInteger.ZERO;
            for(int i=0;i<1000;i++) {
                String owner=owners[random.nextInt(3)];boolean buy=random.nextBoolean();long price=90+random.nextInt(21),qty=1+random.nextInt(3);
                var taker=new RefOrder(owner,buy,price,qty,i);
                var eligible=new ArrayList<RefOrder>();
                for(var maker:reference)if(maker.remaining>0 && maker.buy!=buy && !maker.owner.equals(owner) && (buy?maker.price<=price:maker.price>=price))eligible.add(maker);
                eligible.sort(Comparator.<RefOrder>comparingLong(o->buy?o.price:-o.price).thenComparingLong(o->o.sequence));
                List<String> expectedFills=new ArrayList<>();
                for(var maker:eligible) {
                    if(taker.remaining==0)break;long size=Math.min(taker.remaining,maker.remaining);taker.remaining-=size;maker.remaining-=size;
                    BigInteger quantity=BigInteger.valueOf(size).multiply(SCALE),cost=BigInteger.valueOf(maker.price*size).multiply(SCALE),fee=cost.add(BigInteger.valueOf(999)).divide(BigInteger.valueOf(1000));
                    String buyer=buy?owner:maker.owner,seller=buy?maker.owner:owner;
                    quote.put(buyer,quote.get(buyer).subtract(cost.add(fee)));quote.put(seller,quote.get(seller).add(cost.subtract(fee)));base.put(buyer,base.get(buyer).add(quantity));base.put(seller,base.get(seller).subtract(quantity));fees=fees.add(fee.multiply(BigInteger.TWO));
                    expectedFills.add(maker.id+"|"+maker.price+"|"+size);
                }
                var actual=trading.submit(owner,new Trading.OrderRequest("model_"+suffix+"_"+i,symbol,buy?"BUY":"SELL","LIMIT","GTC",""+price,""+qty));
                taker.id=(String)actual.get("id");reference.add(taker);
                assertEquals(taker.remaining,((BigDecimal)actual.get("remaining")).longValueExact(),"seed=64132026 step="+i);
                var fills=db.queryForList("SELECT maker_order,price,quantity FROM fills WHERE taker_order=? ORDER BY id",taker.id);
                var actualFills=fills.stream().map(f->f.get("maker_order")+"|"+((BigDecimal)f.get("price")).longValueExact()+"|"+((BigDecimal)f.get("quantity")).longValueExact()).toList();
                assertEquals(expectedFills,actualFills,"price/time or self-trade mismatch at "+i);
            }
            for(var o:reference)if(o.remaining>0)trading.cancel(o.owner,o.id);
            for(String owner:owners) {
                assertEquals(quote.get(owner),ledger.balance(owner,"SPOT","USDT","available").movePointRight(8).toBigIntegerExact());
                assertEquals(base.get(owner),ledger.balance(owner,"SPOT",asset,"available").movePointRight(8).toBigIntegerExact());
                assertEquals(0,ledger.balance(owner,"SPOT","USDT","held").signum());
            }
            assertEquals(true,ledger.reconcile().get("balanced"));
            status.setRollbackOnly();
        });
    }
    @Test void injectedMidJournalFailureRollsBackEarlierLegsAndAuditRows() {
        String owner="fault"+UUID.randomUUID().toString().substring(0,6),ref="fault_"+UUID.randomUUID();
        tx.executeWithoutResult(s->{ledger.lock();ledger.fund(owner,"USDT",new BigDecimal("10"));});
        var before=ledger.balance(owner,"SPOT","USDT","available");
        assertThrows(IllegalArgumentException.class,()->tx.executeWithoutResult(s->{ledger.lock();ledger.post(ref,"FAULT_TEST",List.of(new Ledger.Leg("fees","SYSTEM","USDT","available",new BigDecimal("11")),new Ledger.Leg(owner,"SPOT","USDT","available",new BigDecimal("-11"))));}));
        assertEquals(before,ledger.balance(owner,"SPOT","USDT","available"));
        assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM journal WHERE reference_id=?",Integer.class,ref));
        assertEquals(true,ledger.reconcile().get("balanced"));
    }
    @Test void retiredInstrumentRetainsCancelableOrdersAndReleasesTheOriginalHold() {
        tx.executeWithoutResult(status->{
            ledger.lock();String owner="retired"+UUID.randomUUID().toString().substring(0,6);
            ledger.fund(owner,"USDT",new BigDecimal("100"));
            db.update("UPDATE instruments SET state='TRADING' WHERE symbol='SOLUSDT'");
            var order=trading.submit(owner,new Trading.OrderRequest("retire_"+UUID.randomUUID(),"SOLUSDT","BUY","LIMIT","GTC","1","10"));
            assertEquals("NEW",order.get("state"));
            db.update("UPDATE instruments SET state='READ_ONLY' WHERE symbol='SOLUSDT'");
            assertEquals("CANCELED",trading.cancel(owner,(String)order.get("id")).get("state"));
            assertEquals(0,ledger.balance(owner,"SPOT","USDT","available").compareTo(new BigDecimal("100")));
            assertEquals(0,ledger.balance(owner,"SPOT","USDT","held").signum());
            assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM orders WHERE id=?",Integer.class,order.get("id")));
            assertEquals(true,ledger.reconcile().get("balanced"));status.setRollbackOnly();
        });
    }
    @Test void databaseRejectsMutationOfPostedHistory() {
        tx.executeWithoutResult(status->{
            ledger.lock();String owner="immutable"+UUID.randomUUID().toString().substring(0,6);
            ledger.fund(owner,"USDT",new BigDecimal("10"));
            long id=db.queryForObject("SELECT id FROM journal WHERE reference_id=?",Long.class,"fund:"+owner+":USDT");
            assertThrows(org.springframework.dao.DataAccessException.class,()->db.update("UPDATE journal SET kind='CORRUPTED' WHERE id=?",id));
            assertThrows(org.springframework.dao.DataAccessException.class,()->db.update("DELETE FROM postings WHERE journal_id=?",id));
            assertEquals(true,ledger.reconcile().get("balanced"));status.setRollbackOnly();
        });
    }
}
