package com.martin.fullreval.service.pricing;

/**
 * Textbook Black-Scholes for a European call/put, kept as pure
 * static math so it can be unit tested with zero Spring/DB context.
 * This is what gets called once PER (instrument, scenario) pair
 * during a full revaluation run.
 */
public final class BlackScholesPricer {

    private BlackScholesPricer() {}

    public static double price(boolean isCall, double spot, double strike,
                                double rate, double vol, double yearsToExpiry) {
        if (yearsToExpiry <= 0) {
            return isCall ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
        }
        double d1 = (Math.log(spot / strike) + (rate + 0.5 * vol * vol) * yearsToExpiry)
                / (vol * Math.sqrt(yearsToExpiry));
        double d2 = d1 - vol * Math.sqrt(yearsToExpiry);

        if (isCall) {
            return spot * cdf(d1) - strike * Math.exp(-rate * yearsToExpiry) * cdf(d2);
        } else {
            return strike * Math.exp(-rate * yearsToExpiry) * cdf(-d2) - spot * cdf(-d1);
        }
    }

    /** Standard normal CDF via the Abramowitz-Stegun approximation (no external math lib needed). */
    private static double cdf(double x) {
        double t = 1.0 / (1.0 + 0.2316419 * Math.abs(x));
        double d = 0.3989423 * Math.exp(-x * x / 2);
        double prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
        return x >= 0 ? 1.0 - prob : prob;
    }
}
