package com.tbfirst.auth.service.impl;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.tbfirst.auth.entity.User;
import com.tbfirst.auth.mapper.UserMapper;
import com.tbfirst.auth.service.DataSeederService;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

/**
 * 初始化种子数据实现。
 *
 * <p><b>职责：</b>{@link DataSeederService} 的唯一实现。
 * 在 Spring 容器初始化完成后（{@link PostConstruct}）遍历 SEED_USERS 常量表，
 * 按 username 判重（selectCount），不存在则 BCrypt 哈希密码后 insert。</p>
 *
 * <p><b>幂等性：</b>每条 seed 记录均 pre-check，故重启服务不会重复插入；
 * 如需重置 seed 用户，请先手动删除再重启。</p>
 *
 * <p><b>注意：</b>密码明文写死在代码里只是开发期便利，生产环境应关闭 seed
 * 或改为从 env/Vault 读取。</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class DataSeederServiceImpl implements DataSeederService {

    private final UserMapper userMapper;
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    /**
     * SEED_USERS：每行五列 = {username, 明文密码, 昵称, 角色, 初始邮箱}。
     * 初始邮箱用 tbfirst.local 子域占位，避免与真实外部邮箱冲突；
     * auth.sys_user 的 ux_sys_user_email_active 索引（LOWER(email)）会保证唯一性，
     * 老库若已存在同名用户，本逻辑通过 selectCount 判重直接跳过，邮箱不会被覆盖。
     */
    private static final String[][] SEED_USERS = {
            {"admin",       "admin123",    "管理员",   "ADMIN", "admin@tbfirst.local"},
            {"zengzimin",   "zimin123",    "曾梓敏",  "USER",  "zengzimin@tbfirst.local"},
            {"qianyaxue",   "yaxue123",    "钱娅雪",  "USER",  "qianyaxue@tbfirst.local"},
            {"may",         "may123",      "May",     "USER",  "may@tbfirst.local"},
            {"tuzhiyi",     "zhiyi123",    "涂芷懿",  "USER",  "tuzhiyi@tbfirst.local"},
            {"chenjin",     "jin123",      "陈瑾",    "USER",  "chenjin@tbfirst.local"},
            {"chentaihao",  "taihao123",   "陈太皞",  "USER",  "chentaihao@tbfirst.local"},
            {"zhongzihao",  "zihao123",    "钟子豪",  "USER",  "zhongzihao@tbfirst.local"},
    };

    @PostConstruct
    public void seed() {
        for (String[] row : SEED_USERS) {
            String username = row[0];
            // SQL: SELECT COUNT(*) FROM auth.sys_user WHERE username = ? AND deleted = 0
            long count = userMapper.selectCount(
                    new LambdaQueryWrapper<User>().eq(User::getUsername, username));
            if (count > 0) {
                // 老库若该用户已存在但 email 为空，幂等补一次初始邮箱（不覆盖已有邮箱）
                if (row.length >= 5 && row[4] != null && !row[4].isBlank()) {
                    User existing = userMapper.selectOne(
                            new LambdaQueryWrapper<User>().eq(User::getUsername, username));
                    if (existing != null
                            && (existing.getEmail() == null || existing.getEmail().isBlank())) {
                        existing.setEmail(row[4]);
                        try {
                            userMapper.updateById(existing);
                            log.info("[Seed] backfilled email for existing user: {} -> {}", username, row[4]);
                        } catch (DuplicateKeyException e) {
                            // 该邮箱已被其他活动用户占用，跳过即可
                            log.warn("[Seed] email {} already taken, skip backfill for {}", row[4], username);
                        }
                    }
                }
                continue;
            }
            User u = new User();
            u.setUsername(username);
            u.setPasswordHash(passwordEncoder.encode(row[1]));
            u.setNickname(row[2]);
            u.setRoles(row[3]);
            if (row.length >= 5 && row[4] != null && !row[4].isBlank()) {
                u.setEmail(row[4]);
            }
            u.setStatus("active");
            try {
                userMapper.insert(u);
                log.info("[Seed] created user: {} (email={})", username, u.getEmail());
            } catch (DuplicateKeyException e) {
                // username 存在但 deleted=1（软删除）时 selectCount 返回 0 但唯一约束仍生效，直接跳过
                log.warn("[Seed] user {} already exists (soft-deleted record), skipping", username);
            }
        }
    }
}
