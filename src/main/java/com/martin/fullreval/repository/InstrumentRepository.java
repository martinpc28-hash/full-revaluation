package com.martin.fullreval.repository;

import com.martin.fullreval.model.Instrument;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface InstrumentRepository extends JpaRepository<Instrument, Long> {
    List<Instrument> findByPortfolioId(Long portfolioId);
}
