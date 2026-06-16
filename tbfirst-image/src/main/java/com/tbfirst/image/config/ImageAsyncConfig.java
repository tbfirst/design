package com.tbfirst.image.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 生图异步线程池配置（P1 生图异步化）。
 *
 * <p>generate() 改为"INSERT pending 立即返回 jobId → 后台出图"后，60-600s 的 AI 调用
 * 在此池执行，不再占用 Tomcat HTTP 工作线程，前端改走 /jobs/&#123;id&#125;/status 轮询。</p>
 *
 * <p>瓶颈在上游 ai-python（外部慢调用），故按"允许的并发生图数"设池而非 CPU 核数；
 * 队列+池满时走默认 AbortPolicy 抛 {@link java.util.concurrent.RejectedExecutionException}，
 * 由 ImageGenerateServiceImpl 捕获后把对应 job 标 failed 并即时回错，避免 job 永久 pending。</p>
 */
@Configuration
public class ImageAsyncConfig {

    @Bean("imageGenExecutor")
    public ThreadPoolTaskExecutor imageGenExecutor() {
        ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
        ex.setCorePoolSize(8);
        ex.setMaxPoolSize(16);
        ex.setQueueCapacity(100);
        ex.setKeepAliveSeconds(120);
        ex.setAllowCoreThreadTimeOut(true);
        ex.setThreadNamePrefix("img-gen-");
        // 优雅停机：等待在途生图收尾（配合 common 的 server.shutdown=graceful + compose stop_grace_period）
        ex.setWaitForTasksToCompleteOnShutdown(true);
        ex.setAwaitTerminationSeconds(30);
        ex.initialize();
        return ex;
    }
}
