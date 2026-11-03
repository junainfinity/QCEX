package com.qcex.core;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** API amounts are plain decimal strings. The canonical unit is 10^-8 of an asset. */
public final class Amounts {
    private Amounts() {}
    public static final BigDecimal ZERO = new BigDecimal("0.00000000");
    public static final BigDecimal FEE = new BigDecimal("0.001");
    public static BigDecimal parse(String value) {
        if (value == null || !value.matches("(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,8})?"))
            throw new IllegalArgumentException("Use a positive plain decimal with at most 8 decimal places");
        var amount = new BigDecimal(value).setScale(8, RoundingMode.UNNECESSARY);
        if (amount.signum() <= 0) throw new IllegalArgumentException("Amount must be greater than zero");
        return amount;
    }
    public static BigDecimal quote(BigDecimal price, BigDecimal quantity) {
        return price.multiply(quantity).setScale(8, RoundingMode.UNNECESSARY);
    }
    public static BigDecimal fee(BigDecimal quote) { return quote.multiply(FEE).setScale(8, RoundingMode.UP); }
    public static String text(BigDecimal amount) { return amount.setScale(8, RoundingMode.UNNECESSARY).toPlainString(); }
}
