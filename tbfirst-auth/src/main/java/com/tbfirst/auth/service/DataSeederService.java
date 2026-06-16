package com.tbfirst.auth.service;

/**
 * 种子数据服务接口 —— 启动时幂等创建默认用户。
 *
 * <p><b>职责：</b>保证空库第一次启动也能直接用管理员账号登录。
 * 当前实现会检查是否已存在 username=admin 的用户，若无则创建一个默认 admin：
 * 邮箱 admin@tbfirst.local、role=ADMIN、status=active。</p>
 *
 * <p><b>触发时机：</b>实际种子动作由
 * {@link com.tbfirst.auth.service.impl.DataSeederServiceImpl#seed()} 的
 * {@code @PostConstruct} 自动触发，无需外部调用；接口保留 seed 方法便于后续
 * 写集成测试或管理后台重新播种。</p>
 *
 * <p><b>幂等性：</b>多次调用不会重复建用户（先查再插）。</p>
 */
public interface DataSeederService {

    /** 执行一次幂等种子。已存在默认 admin 时直接返回。 */
    void seed();
}
