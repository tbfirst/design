package com.tbfirst.common.core.constant;

/**
 * 全平台通用常量集合。
 * <p>
 * 集中定义跨服务共享的请求头名称和命名空间标识，任何硬编码字符串都应改为引用本类，
 * 防止因魔法字符串不一致导致的鉴权/链路丢失问题。
 * </p>
 *
 * @author tbfirst
 */
public final class CommonConstants {

    // 纯常量类，禁止实例化
    private CommonConstants() {}

    /** Gateway 向下游透传的请求头：用户 ID（鉴权完成后注入，业务层直接读取） */
    public static final String HEADER_USER_ID = "X-User-Id";
    /** Gateway 向下游透传的请求头：用户名（展示/审计用途） */
    public static final String HEADER_USER_NAME = "X-User-Name";
    /** Gateway 向下游透传的请求头：用户角色列表（逗号分隔） */
    public static final String HEADER_USER_ROLES = "X-User-Roles";
    /**
     * Gateway 向下游透传的请求头：用户当前所属资源共享组 ID。
     * 单组制（每人最多一个组）：空串 = 用户无组；下游 image 服务据此决定
     * brand_model / generation_job 的"组库 / 组互见"可见性。
     */
    public static final String HEADER_USER_GROUP_ID = "X-User-Group-Id";
    /**
     * Gateway 向下游透传的请求头：用户在所属组内的角色（leader | member）。
     * 空串 = 无组；leader = 二级管理员，有组库全权操作权限。
     */
    public static final String HEADER_USER_GROUP_ROLE = "X-User-Group-Role";
    /**
     * Gateway 向下游透传的请求头：用户的个人模特库容量覆盖值。
     * 空串 = null = 按角色默认（USER=5 / ADMIN=50）；非空整数 = 覆盖。
     */
    public static final String HEADER_USER_PERSONAL_CAP = "X-User-Personal-Cap";
    /**
     * Gateway 向下游透传的请求头：用户当前组的模特库容量覆盖值。
     * 空串 = null = 默认 30；非空整数 = 覆盖。
     */
    public static final String HEADER_USER_GROUP_CAP = "X-User-Group-Cap";
    /** Gateway 向下游透传的请求头：租户 ID（多租户场景） */
    public static final String HEADER_TENANT_ID = "X-Tenant-Id";
    /** Gateway 向下游透传的请求头：链路追踪 ID，贯穿全链路日志 */
    public static final String HEADER_TRACE_ID = "X-Trace-Id";

    /** 内网调用鉴权头（Java ↔ Python AI service），防止外部直接访问内部端点 */
    public static final String HEADER_INTERNAL_TOKEN = "X-Internal-Token";

    /** Nacos 默认命名空间，开发环境使用 dev，生产可在配置中覆盖 */
    // todo 后续改为全局各容器采用统一环境，即将 DEFAULT_NS 改为 ENVIRONMENT，值为 dev / staging / prod 等，生产环境通过环境变量覆盖为 prod
    public static final String DEFAULT_NS = "dev";
}
