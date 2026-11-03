package com.qcex.ledger;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
class LedgerContractTest {
    @Test void rejectsCrossAssetFalseBalance() {
        assertThrows(IllegalStateException.class,()->Ledger.verifyBalanced(List.of(new Ledger.Leg("a","SPOT","BTC","available",new BigDecimal("-1")),new Ledger.Leg("b","SPOT","USDT","available",new BigDecimal("1")))));
    }
    @Test void settlementIsBalancedIncludingFeesAndHeldFunds() {
        assertDoesNotThrow(()->Ledger.verifyBalanced(List.of(new Ledger.Leg("buyer","SPOT","USDT","held",new BigDecimal("-65.07501")),new Ledger.Leg("seller","SPOT","USDT","available",new BigDecimal("64.94499")),new Ledger.Leg("fees","SYSTEM","USDT","available",new BigDecimal("0.13002")),new Ledger.Leg("seller","SPOT","BTC","held",new BigDecimal("-0.001")),new Ledger.Leg("buyer","SPOT","BTC","available",new BigDecimal("0.001")))));
    }
    @Test void rejectsSubAtomPosting() {assertThrows(ArithmeticException.class,()->Ledger.verifyBalanced(List.of(new Ledger.Leg("a","SPOT","USDT","available",new BigDecimal("-0.000000001")),new Ledger.Leg("b","SPOT","USDT","available",new BigDecimal("0.000000001")))));}
}
