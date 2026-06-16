# 多模块统一 Dockerfile：通过 MODULE 参数构建指定服务
# 构建 tbfirst-dependencies、tbfirst-common、tbfirst-gateway 等模块
# 使用：docker build -f infra/docker/java.Dockerfile --build-arg MODULE=tbfirst-image .

FROM maven:3.9-eclipse-temurin-21 AS builder
WORKDIR /build
COPY pom.xml .
COPY tbfirst-dependencies/pom.xml tbfirst-dependencies/
COPY tbfirst-common tbfirst-common
COPY tbfirst-gateway tbfirst-gateway
COPY tbfirst-auth tbfirst-auth
COPY tbfirst-image tbfirst-image
COPY tbfirst-cinestitch tbfirst-cinestitch
ARG MODULE
RUN mvn -T 2C -pl ${MODULE} -am clean package -DskipTests

FROM eclipse-temurin:21-jre
ARG MODULE
WORKDIR /app
COPY --from=builder /build/${MODULE}/target/*.jar /app/app.jar
ENV JAVA_OPTS="-XX:+UseZGC -XX:MaxRAMPercentage=75"
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/app.jar"]
