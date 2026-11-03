package com.qcex.trading;

import com.qcex.ledger.Ledger;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import java.math.BigDecimal;
import java.util.Map;

@Component
public class SandboxSeed implements ApplicationRunner {
    private final JdbcTemplate db; private final Ledger ledger; private final Trading trading; private final TransactionTemplate tx;
    public SandboxSeed(JdbcTemplate db,Ledger ledger,Trading trading,TransactionTemplate tx){this.db=db;this.ledger=ledger;this.trading=trading;this.tx=tx;}
    public void run(ApplicationArguments args) {
        tx.executeWithoutResult(status->{
            ledger.lock();
            if(db.queryForObject("SELECT COUNT(*) FROM journal WHERE reference_id='fund:liquidity:USDT'",Long.class)>0)return;
            Map.of("USDT","10000000","BTC","500","ETH","10000","SOL","100000").forEach((a,v)->ledger.fund("liquidity",a,new BigDecimal(v)));
            Map.of("BTCUSDT","65000","ETHUSDT","3200").forEach((symbol,reference)->{
                BigDecimal ref=new BigDecimal(reference),spread=symbol.equals("BTCUSDT")?new BigDecimal("10"):symbol.equals("ETHUSDT")?new BigDecimal("0.5"):new BigDecimal("0.05");
                for(int level=1;level<=12;level++)for(String side:new String[]{"BUY","SELL"}) {
                    var price=ref.add(spread.multiply(BigDecimal.valueOf(side.equals("BUY")?-level:level)));
                    trading.submit("liquidity",new Trading.OrderRequest("seed_"+symbol+"_"+side+"_"+level,symbol,side,"LIMIT","GTC",price.toPlainString(),symbol.equals("BTCUSDT")?"0.2":symbol.equals("ETHUSDT")?"4":"80"));
                }
            });
        });
    }
}
