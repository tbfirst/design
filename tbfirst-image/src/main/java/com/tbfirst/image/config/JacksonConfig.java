package com.tbfirst.image.config;

import com.fasterxml.jackson.core.StreamReadConstraints;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * AI 图片接口返回的 base64 data URI 可超过 Jackson 默认的 20MB 字符串上限，
 * 导致 Feign 解码时抛 StreamConstraintsException → 500。
 * 将上限提升至 100MB，覆盖 inpaint / generate 等场景。
 */
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer jacksonStreamReadCustomizer() {
        return builder -> builder.postConfigurer(mapper ->
                mapper.getFactory().setStreamReadConstraints(
                        StreamReadConstraints.builder()
                                .maxStringLength(100_000_000)
                                .build()
                )
        );
    }
}
