package com.tbfirst.auth.config;

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
 * <p>auth 服务的特殊性：登录 / 注册 / 刷新 token 三个接口在 AuthGlobalFilter
 * 白名单中无需 JWT；其余接口（用户管理 / 共享组 / 邀请等）均需 JWT。
 * swagger-ui 的「Authorize」按钮可以让你调一次登录拿到 token 后注入到所有
 * 后续 Try-it-out 调用里。</p>
 *
 * <p>本服务的 swagger 入口：
 * <ul>
 *   <li>直连：{@code http://localhost:8101/swagger-ui/index.html}</li>
 *   <li>网关：{@code http://localhost:8000/tbfirst-auth/swagger-ui/index.html}</li>
 * </ul>
 * </p>
 */
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI authOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("tbfirst-auth API")
                        .description("登录 / 注册 / 用户 / 共享组 / 邀请 等认证业务接口")
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
