package com.tbfirst.auth.controller;

import com.tbfirst.auth.entity.User;
import com.tbfirst.auth.mapper.UserMapper;
import com.tbfirst.common.core.response.R;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 服务间内部调用接口，仅供 tbfirst 体系内其它服务通过 Feign 访问。
 */
@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/auth/internal")
public class InternalController {

    private final UserMapper userMapper;

    /**
     * 批量查 userId -> username 映射。供 tbfirst-image 的 HistoryModal 展示组员名。
     */
    @PostMapping("/users-by-ids")
    public R<Map<String, String>> usersByIds(@RequestBody Collection<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return R.ok(Collections.emptyMap());
        }
        List<User> users = userMapper.selectBatchIds(ids);
        Map<String, String> map = users.stream()
                .collect(Collectors.toMap(u -> String.valueOf(u.getId()), User::getUsername));
        log.debug("[Internal] usersByIds requested={} returned={}", ids.size(), map.size());
        return R.ok(map);
    }
}
