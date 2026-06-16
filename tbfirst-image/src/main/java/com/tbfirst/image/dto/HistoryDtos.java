package com.tbfirst.image.dto;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 历史生图视图 DTO —— 在原始 {@link com.tbfirst.image.entity.GenerationJob} 字段上
 * 补一条 {@link #authorName}，让前端 HistoryModal 左上角徽标可以显示 "组员 {username}"
 * 而不是之前的 "组员 {数字 id}"。
 *
 * <p>为什么不直接给 GenerationJob 加 @Transient —— JPA 实体混入 View 字段会模糊
 * "持久态 vs 展示态"的边界，而且批量查 username 的逻辑属于 Service 层聚合关注点。
 * 单独 DTO 更清晰：History 专用，未来若要加"已下载次数"等组合字段也只动本类。</p>
 */
public class HistoryDtos {

    @Data
    public static class HistoryJobView {
        private Long id;
        private String phase;
        private String prompt;
        private String assetUrls;
        private String status;
        private Boolean saved;
        /** 作者 userId —— 前端仍用它与当前登录用户比对判定 "本人 / 组员" 徽标 */
        private Long userId;
        /** 作者用户名 —— 前端徽标文本，auth 服务不可达时可能为 null，前端 fallback 到 userId */
        private String authorName;
        private LocalDateTime createTime;
        private LocalDateTime lastAccessAt;
        private String phaseConfig;
    }
}
