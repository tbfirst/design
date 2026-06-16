package com.tbfirst.common.security.context;

import lombok.Builder;
import lombok.Data;

import java.util.List;

/**
 * 用户上下文信息载体。
 * <p>
 * Gateway 完成 JWT 鉴权后将用户信息通过 X-User-* 头传递到下游，下游由
 * {@link com.tbfirst.common.security.filter.UserContextFilter} 解析出本对象，
 * 并放入 {@link UserContextHolder} 供业务层读取，实现"一次鉴权，全链路可用"。
 * </p>
 *
 * @author tbfirst
 */
@Data
@Builder
public class UserContext {
    /** 用户 ID，对应 users 表主键 */
    private Long userId;

    /** 用户名（登录名/展示名） */
    private String username;

    /** 角色列表，用于权限判断（admin/employee 等） */
    private List<String> roles;

    /** 租户 ID，多租户隔离场景使用，单租户可为 null */
    private Long tenantId;

    /**
     * 用户当前所属资源共享组 ID（单组制：每人最多一个）。
     * null = 未加入任何组；非 null 时下游服务据此判断组库 / 组互见数据范围。
     */
    private Long groupId;

    /** 组内角色：leader | member；null = 无组。leader 具备组库全权删除 / 改名权限。 */
    private String groupRole;

    /**
     * 个人模特库容量覆盖值；null = 按角色默认（USER=5 / ADMIN=50）。
     * Service 层读取时用 `personalModelCap != null ? personalModelCap : (isAdmin ? 50 : 5)`。
     */
    private Integer personalModelCap;

    /**
     * 当前组的模特库容量覆盖值；null = 默认 30。
     */
    private Integer groupModelCap;
}
