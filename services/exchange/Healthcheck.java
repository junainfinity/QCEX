import java.net.URI;
import java.net.http.*;
import java.time.Duration;
public class Healthcheck {
    public static void main(String[] args) throws Exception {
        var request=HttpRequest.newBuilder(URI.create("http://127.0.0.1:8088/actuator/health")).timeout(Duration.ofSeconds(3)).build();
        var response=HttpClient.newHttpClient().send(request,HttpResponse.BodyHandlers.ofString());
        if(response.statusCode()!=200 || !response.body().contains("UP"))System.exit(1);
    }
}
