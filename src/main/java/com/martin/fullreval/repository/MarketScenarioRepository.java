package com.martin.fullreval.repository;

import com.martin.fullreval.model.MarketScenario;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface MarketScenarioRepository extends JpaRepository<MarketScenario, Long> {
    List<MarketScenario> findByScenarioSetId(String scenarioSetId);
}
