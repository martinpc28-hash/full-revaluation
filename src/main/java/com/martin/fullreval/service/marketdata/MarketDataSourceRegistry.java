package com.martin.fullreval.service.marketdata;

import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class MarketDataSourceRegistry {

    private final Map<String, MarketDataSource> byId = new LinkedHashMap<>();

    public MarketDataSourceRegistry(List<MarketDataSource> sources) {
        // Fixed, deliberate order (Yahoo first — it's the one that actually works)
        // rather than whatever order Spring happened to construct beans in.
        sources.stream()
                .sorted((a, b) -> Boolean.compare(b.isAvailable(), a.isAvailable()))
                .forEach(s -> byId.put(s.getId(), s));
    }

    public MarketDataSource get(String id) {
        MarketDataSource source = byId.get(id);
        if (source == null) {
            throw new IllegalArgumentException("Unknown data source '" + id + "'. Known: " + byId.keySet());
        }
        if (!source.isAvailable()) {
            throw new IllegalStateException(source.getDisplayName() + " is not configured (no API key) — "
                    + "use Yahoo Finance, or set the required env var and redeploy.");
        }
        return source;
    }

    public List<Map<String, Object>> listAll() {
        return byId.values().stream()
                .map(s -> Map.<String, Object>of("id", s.getId(), "name", s.getDisplayName(), "available", s.isAvailable()))
                .toList();
    }
}
