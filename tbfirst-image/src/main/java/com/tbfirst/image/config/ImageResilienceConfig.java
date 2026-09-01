package com.tbfirst.image.config;

import com.tbfirst.image.resilience.TimedCircuitBreaker;
import feign.FeignException;
import feign.RetryableException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

@Configuration
public class ImageResilienceConfig {

    @Bean
    public TimedCircuitBreaker aiPythonGenerateCircuitBreaker(
            @Value("${app.resilience.ai-python.initial-open-duration:15s}") Duration initialOpenDuration,
            @Value("${app.resilience.ai-python.max-open-duration:120s}") Duration maxOpenDuration) {
        return new TimedCircuitBreaker(
                initialOpenDuration,
                maxOpenDuration,
                ImageResilienceConfig::isUpstreamFailure
        );
    }

    @Bean
    public HealthIndicator aiPythonCircuitHealthIndicator(TimedCircuitBreaker breaker) {
        return () -> {
            Health.Builder health = switch (breaker.getState()) {
                case CLOSED -> Health.up();
                case HALF_OPEN -> Health.unknown();
                case OPEN -> Health.outOfService();
            };
            return health
                    .withDetail("state", breaker.getState())
                    .withDetail("retryAfterMs", breaker.getRetryAfter().toMillis())
                    .build();
        };
    }

    static boolean isUpstreamFailure(Throwable error) {
        if (error instanceof RetryableException) {
            return true;
        }
        if (error instanceof FeignException feign) {
            int status = feign.status();
            return status < 0 || status == 408 || status == 429 || status >= 500;
        }
        return true;
    }
}
