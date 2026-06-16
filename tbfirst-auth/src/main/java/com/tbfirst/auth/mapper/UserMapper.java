package com.tbfirst.auth.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.tbfirst.auth.entity.User;
import org.apache.ibatis.annotations.Param;

/**
 * 用户表 Mapper：对应 {@code auth.sys_user}。
 *
 * <p><b>继承 {@link BaseMapper}</b> 获得单表 CRUD 能力（insert / updateById /
 * selectById / selectBatchIds / selectList(wrapper) / deleteById 等）。
 * 所有继承方法都会自动追加 {@code deleted = 0} 过滤（由 {@code @TableLogic} 生效）。</p>
 *
 * <p><b>自定义 SQL：</b>邮箱的大小写不敏感判重无法用 LambdaQueryWrapper 精确表达
 * （wrapper 会对参数做大小写敏感匹配），故走 {@code resources/mapper/UserMapper.xml}。</p>
 */
public interface UserMapper extends BaseMapper<User> {

    /**
     * 按邮箱（大小写不敏感）查 {@code deleted = 0} 的用户。
     *
     * <p>SQL：
     * <pre>
     * SELECT * FROM auth.sys_user
     * WHERE LOWER(email) = LOWER(#{email}) AND deleted = 0
     * LIMIT 1
     * </pre>
     *
     * @param email 原文邮箱（Service 层应已 trim + toLowerCase，但 XML 里再 LOWER 一遍以防御）
     * @return 命中的用户；无则 null
     */
    User findByEmailIgnoreCaseAndNotDeleted(@Param("email") String email);

    /**
     * 注册 / admin createUser 时判重用：某邮箱是否已被未软删账号占用。
     *
     * <p>SQL：
     * <pre>
     * SELECT EXISTS(
     *   SELECT 1 FROM auth.sys_user
     *   WHERE LOWER(email) = LOWER(#{email}) AND deleted = 0
     * )
     * </pre>
     *
     * @return 已被占用返回 true，否则 false
     */
    boolean existsByEmailIgnoreCaseAndNotDeleted(@Param("email") String email);
}
