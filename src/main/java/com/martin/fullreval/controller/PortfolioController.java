package com.martin.fullreval.controller;

import com.martin.fullreval.dto.BondRequest;
import com.martin.fullreval.dto.EquityRequest;
import com.martin.fullreval.dto.OptionRequest;
import com.martin.fullreval.model.Bond;
import com.martin.fullreval.model.Equity;
import com.martin.fullreval.model.EuropeanOption;
import com.martin.fullreval.model.Instrument;
import com.martin.fullreval.repository.InstrumentRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Optional;

@RestController
@RequestMapping("/api/portfolios/{portfolioId}/instruments")
public class PortfolioController {

    private final InstrumentRepository instrumentRepository;

    public PortfolioController(InstrumentRepository instrumentRepository) {
        this.instrumentRepository = instrumentRepository;
    }

    @PostMapping("/bonds")
    public Instrument addBond(@PathVariable Long portfolioId, @RequestBody BondRequest req) {
        Bond bond = new Bond();
        bond.setPortfolioId(portfolioId);
        bond.setName(req.name);
        bond.setNotional(req.notional);
        bond.setCouponRate(req.couponRate);
        bond.setYearsToMaturity(req.yearsToMaturity);
        bond.setBaseYield(req.baseYield);
        bond.setCurrency(req.currency);
        bond.setBaseFxRate(req.baseFxRate);
        return instrumentRepository.save(bond);
    }

    @PostMapping("/options")
    public Instrument addOption(@PathVariable Long portfolioId, @RequestBody OptionRequest req) {
        EuropeanOption option = new EuropeanOption();
        option.setPortfolioId(portfolioId);
        option.setName(req.name);
        option.setNotional(req.notional);
        option.setOptionType(req.optionType);
        option.setStrike(req.strike);
        option.setBaseSpot(req.baseSpot);
        option.setBaseVol(req.baseVol);
        option.setRiskFreeRate(req.riskFreeRate);
        option.setYearsToExpiry(req.yearsToExpiry);
        option.setCurrency(req.currency);
        option.setBaseFxRate(req.baseFxRate);
        return instrumentRepository.save(option);
    }

    @PostMapping("/equities")
    public Instrument addEquity(@PathVariable Long portfolioId, @RequestBody EquityRequest req) {
        Equity equity = new Equity();
        equity.setPortfolioId(portfolioId);
        equity.setName(req.name);
        equity.setShares(req.shares);
        equity.setBaseSpot(req.baseSpot);
        // Notional is informational here (market value at t0 = shares x spot);
        // the actual reval uses shares/baseSpot directly, not notional.
        equity.setNotional(req.shares.multiply(req.baseSpot));
        equity.setCurrency(req.currency);
        equity.setBaseFxRate(req.baseFxRate);
        return instrumentRepository.save(equity);
    }

    @GetMapping
    public List<Instrument> listInstruments(@PathVariable Long portfolioId) {
        return instrumentRepository.findByPortfolioId(portfolioId);
    }

    @DeleteMapping("/{instrumentId}")
    public ResponseEntity<Void> deleteInstrument(@PathVariable Long portfolioId, @PathVariable Long instrumentId) {
        Optional<Instrument> existing = instrumentRepository.findById(instrumentId);
        if (existing.isEmpty() || !existing.get().getPortfolioId().equals(portfolioId)) {
            return ResponseEntity.notFound().build();
        }
        instrumentRepository.deleteById(instrumentId);
        return ResponseEntity.noContent().build();
    }
}
