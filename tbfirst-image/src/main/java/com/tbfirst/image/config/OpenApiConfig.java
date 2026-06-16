package com.tbfirst.image.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * OpenAPI / Swagger UI 元信息与全局 BearerAuth 鉴权方案。
 *
 * <p>声明 HTTP Bearer JWT 安全方案后，swagger-ui 页面右上角会出现
 * 「Authorize」按钮：用户先调用 {@code POST /api/auth/login} 拿到 access_token，
 * 复制粘贴到 Authorize 弹框里；之后每个 Try-it-out 调用都会自动带
 * {@code Authorization: Bearer <token>} 头，从而通过网关 AuthGlobalFilter +
 * 下游 UserContextFilter 的 JWT 校验。</p>
 *
 * <p>本服务的 swagger 入口：
 * <ul>
 *   <li>直连：{@code http://localhost:8102/swagger-ui/index.html}</li>
 *   <li>网关：{@code http://localhost:8000/tbfirst-image/swagger-ui/index.html}</li>
 * </ul>
 * </p>
 */
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI imageOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("tbfirst-image API")
                        .description("生图 / 重修图 / 共享组 / 历史记录 等图像业务接口")
                        .version("v1"))
                .components(new Components().addSecuritySchemes("BearerAuth",
                        new SecurityScheme()
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")
                                .description("先调 /api/auth/login 拿 token，粘贴到这里")))
                .addSecurityItem(new SecurityRequirement().addList("BearerAuth"));
    }
}
