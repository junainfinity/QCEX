FROM maven:3.9.16-eclipse-temurin-25@sha256:e8df0a46597d36dde873fb055ffeea62f25d484fe47dd0df4391b96f4c0158ff AS build
WORKDIR /build
COPY services/exchange/pom.xml ./pom.xml
RUN mvn -B -ntp dependency:go-offline
COPY services/exchange/src ./src
COPY services/exchange/Healthcheck.java ./Healthcheck.java
RUN mvn -B -ntp package && javac -d health Healthcheck.java

FROM eclipse-temurin:25-jre@sha256:fc1d6f87fb82850660c8fa5f9f8eedc5eb25fc28c3686a3e00efd8dc45df8b19
WORKDIR /app
COPY --from=build --chown=10001:10001 /build/target/exchange-0.1.0.jar ./app.jar
COPY --from=build --chown=10001:10001 /build/health ./health
USER 10001:10001
EXPOSE 8088
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=70", "-jar", "/app/app.jar"]
