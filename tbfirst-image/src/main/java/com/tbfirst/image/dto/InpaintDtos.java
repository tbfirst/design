package com.tbfirst.image.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 局部重绘 DTO 集合 —— 供 {@link com.tbfirst.image.controller.ImageController#inpaint} 使用。
 */
public class InpaintDtos {

    /** 重绘请求。前端需先在原图上用红色绘制蒙版并合成为 maskedImage */
    @Data
    public static class InpaintRequest {
        /** base64 data URI，带红色遮罩的原图 */
        @NotBlank
        private String maskedImage;
        @NotBlank
        private String prompt;
        /** 可选参考图 */
        private String referenceImage;
        private String aspectRatio = "3:4";
    }

    /** 重绘响应：单张结果 + 关联 job id */
    // todo 未来可改为多张结果 + 结果质量评分 + 关联 job id，前端可根据 job id 查询历史记录接口获取历史图片列表和评分
    @Data
    public static class InpaintResponse {
        private String url;
        private Long jobId;
    }
}
