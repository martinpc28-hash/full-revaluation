package com.martin.fullreval.repository;

import com.martin.fullreval.model.RevaluationResult;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface RevaluationResultRepository extends JpaRepository<RevaluationResult, Long> {
    List<RevaluationResult> findByRunId(String runId);
}
