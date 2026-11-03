package com.qcex.core;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.Random;

class AmountsTest {
    @Test void plainDecimalBoundaryContract() {
        for(String invalid:new String[]{"-1","0","NaN","Infinity","1e3",".1","01","1.000000001","1000000000000"," 1","1 ","1,000"}) assertThrows(IllegalArgumentException.class,()->Amounts.parse(invalid),invalid);
        assertEquals("0.00000001",Amounts.text(Amounts.parse("0.00000001")));
        assertEquals("999999999999.99999999",Amounts.text(Amounts.parse("999999999999.99999999")));
        assertThrows(ArithmeticException.class,()->Amounts.quote(new BigDecimal("0.01"),new BigDecimal("0.00000001")));
    }
    @Test void documentedFeeAndSettlementExamples() {
        assertEquals("65.01000000",Amounts.text(Amounts.quote(Amounts.parse("65010"),Amounts.parse("0.001"))));
        assertEquals("0.06501000",Amounts.text(Amounts.fee(new BigDecimal("65.01"))));
        assertEquals("0.00000001",Amounts.text(Amounts.fee(new BigDecimal("0.00000001"))));
    }
    @Test void millionSeededFeesMatchIntegerCeilingOracle() {
        var random=new Random(20260921);
        for(int i=0;i<1_000_000;i++) {
            long quoteAtoms=1+random.nextLong(1_000_000_000_000L);
            BigInteger expected=BigInteger.valueOf(quoteAtoms).add(BigInteger.valueOf(999)).divide(BigInteger.valueOf(1000));
            BigInteger actual=Amounts.fee(BigDecimal.valueOf(quoteAtoms,8)).movePointRight(8).toBigIntegerExact();
            assertEquals(expected,actual,"seed=20260921 iteration="+i);
        }
    }
}
