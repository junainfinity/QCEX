package com.qcex.api;

import com.qcex.core.Amounts;
import com.qcex.identity.Identity;
import com.qcex.ledger.Ledger;
import com.qcex.trading.Trading;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.*;

@RestController
@RequestMapping("/api")
public class Api {
    private final JdbcTemplate db;private final Identity identity;private final Trading trading;private final Ledger ledger;
    public Api(JdbcTemplate db,Identity identity,Trading trading,Ledger ledger){this.db=db;this.identity=identity;this.trading=trading;this.ledger=ledger;}
    public record Credentials(String handle,String password,String demoCode) {}
    static Object wire(Object value) {
        if(value instanceof BigDecimal d)return Amounts.text(d);
        if(value instanceof Map<?,?> map){var result=new LinkedHashMap<String,Object>();map.forEach((k,v)->result.put(k.toString(),wire(v)));return result;}
        if(value instanceof List<?> list)return list.stream().map(Api::wire).toList();
        if(value instanceof java.time.temporal.TemporalAccessor || value instanceof java.util.Date)return value.toString();
        return value;
    }
    @PostMapping(value="/auth/{action}",consumes=MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<?> auth(@PathVariable String action,@RequestBody Credentials credentials,HttpServletRequest request){
        if(!Set.of("register","login").contains(action))throw new IllegalArgumentException("Unsupported auth action");
        identity.throttle(request.getRemoteAddr());
        // Fixed-code demo verification only; this is deliberately not TOTP/MFA.
        if("qcex_demo".equalsIgnoreCase(credentials.handle()) && !"123456".equals(credentials.demoCode()))
            throw new Identity.Unauthorized();
        var result=identity.authenticate(credentials.handle(),credentials.password(),action.equals("register"));
        var cookie=ResponseCookie.from("lc_session",result.get("token")).httpOnly(true).secure(Boolean.parseBoolean(System.getenv("COOKIE_SECURE"))).sameSite("Strict").path("/").maxAge(28800).build();
        return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE,cookie.toString()).body(Map.of("id",result.get("id"),"handle",result.get("handle")));
    }
    @PostMapping("/auth/logout") public ResponseEntity<?> logout(@CookieValue(name="lc_session",required=false)String token){identity.logout(token);return ResponseEntity.ok().header(HttpHeaders.SET_COOKIE,ResponseCookie.from("lc_session","").path("/").httpOnly(true).sameSite("Strict").maxAge(0).build().toString()).body(Map.of("ok",true));}
    @GetMapping("/markets") public Object markets(){return wire(db.queryForList("SELECT i.*, (SELECT price FROM fills f WHERE f.symbol=i.symbol ORDER BY id DESC LIMIT 1) last_price, (SELECT COALESCE(SUM(quantity),0) FROM fills f WHERE f.symbol=i.symbol AND created_at>DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 24 HOUR)) volume FROM instruments i WHERE i.state='TRADING' ORDER BY i.symbol"));}
    @GetMapping("/book/{symbol}")
    @Transactional(readOnly=true)
    public Object book(@PathVariable String symbol){trading.instrument(symbol);return wire(Map.of("symbol",symbol,"bids",db.queryForList("SELECT price,SUM(remaining) quantity FROM orders WHERE symbol=? AND side='BUY' AND state IN ('NEW','PARTIALLY_FILLED') GROUP BY price ORDER BY price DESC LIMIT 16",symbol),"asks",db.queryForList("SELECT price,SUM(remaining) quantity FROM orders WHERE symbol=? AND side='SELL' AND state IN ('NEW','PARTIALLY_FILLED') GROUP BY price ORDER BY price ASC LIMIT 16",symbol),"trades",db.queryForList("SELECT id,price,quantity,created_at FROM fills WHERE symbol=? ORDER BY id DESC LIMIT 80",symbol),"sequence",db.queryForObject("SELECT COALESCE(MAX(id),0) FROM outbox",Long.class)));}
    @GetMapping("/account") @Transactional(readOnly=true)
    public Object account(@CookieValue(name="lc_session",required=false)String token){String user=identity.require(token);return wire(Map.of("user",db.queryForMap("SELECT id,handle FROM users WHERE id=?",user),"balances",db.queryForList("SELECT wallet,asset,available,held FROM balances WHERE owner_id=? ORDER BY wallet,asset",user),"orders",db.queryForList("SELECT * FROM orders WHERE owner_id=? ORDER BY sequence_id DESC LIMIT 200",user),"fills",db.queryForList("SELECT *, CASE WHEN buyer=? THEN 'BUY' ELSE 'SELL' END side FROM fills WHERE buyer=? OR seller=? ORDER BY id DESC LIMIT 200",user,user,user),"subscriptions",db.queryForList("SELECT * FROM subscriptions WHERE owner_id=? ORDER BY created_at DESC",user),"history",db.queryForList("SELECT p.id,j.reference_id,j.kind,p.wallet,p.asset,p.bucket,p.amount,j.created_at FROM postings p JOIN journal j ON p.journal_id=j.id WHERE p.owner_id=? ORDER BY p.id DESC LIMIT 200",user)));}
    @PostMapping(value="/orders",consumes=MediaType.APPLICATION_JSON_VALUE) public Object submit(@CookieValue(name="lc_session",required=false)String token,@RequestBody Trading.OrderRequest request){return wire(trading.submit(identity.require(token),request));}
    @DeleteMapping("/orders/{id}") public Object cancel(@CookieValue(name="lc_session",required=false)String token,@PathVariable String id){return wire(trading.cancel(identity.require(token),id));}
    @GetMapping("/commands/{id}") public Object command(@CookieValue(name="lc_session",required=false)String token,@PathVariable String id){
        String owner=identity.require(token);var rows=db.queryForList("SELECT result_id FROM commands WHERE owner_id=? AND command_id=?",owner,id);
        if(rows.isEmpty())return Map.of("found",false);
        String result=(String)rows.getFirst().get("result_id");var orders=db.queryForList("SELECT * FROM orders WHERE id=? AND owner_id=?",result,owner);
        return wire(Map.of("found",true,"resultId",result,"order",orders.isEmpty()?Map.of():orders.getFirst()));
    }
    @PostMapping(value="/transfers",consumes=MediaType.APPLICATION_JSON_VALUE) public Object transfer(@CookieValue(name="lc_session",required=false)String token,@RequestBody Trading.TransferRequest request){return wire(trading.transfer(identity.require(token),request));}
    @PostMapping(value="/earn",consumes=MediaType.APPLICATION_JSON_VALUE) public Object earn(@CookieValue(name="lc_session",required=false)String token,@RequestBody Trading.EarnRequest request){return wire(trading.subscribe(identity.require(token),request));}
    @PostMapping("/earn/{id}/redeem") public Object redeem(@CookieValue(name="lc_session",required=false)String token,@PathVariable String id){return wire(trading.redeem(identity.require(token),id));}
    @GetMapping("/status") @Transactional(readOnly=true) public Object status(){return wire(Map.of("mode","SANDBOX","release","0.1.0-development","ledger",ledger.reconcile(),"capabilities",List.of("spot-limit","protected-market-ioc","fok","post-only","cancel","transfers","earn-principal"),"pending",List.of("margin","futures","staking","options","production-custody","full-graph-qualification")));}
    @ExceptionHandler(Identity.Unauthorized.class) @ResponseStatus(HttpStatus.UNAUTHORIZED) public Object unauthorized(){return Map.of("error","Sign in to continue");}
    @ExceptionHandler(Identity.TooManyAttempts.class) @ResponseStatus(HttpStatus.TOO_MANY_REQUESTS) public Object limited(){return Map.of("error","Too many authentication attempts. Try again in one minute.");}
    @ExceptionHandler(Trading.Conflict.class) @ResponseStatus(HttpStatus.CONFLICT) public Object conflict(Trading.Conflict e){return Map.of("error",e.getMessage());}
    @ExceptionHandler({IllegalArgumentException.class,ArithmeticException.class}) @ResponseStatus(HttpStatus.BAD_REQUEST) public Object invalid(RuntimeException e){return Map.of("error",e instanceof ArithmeticException?"Amount cannot be represented exactly":e.getMessage());}
}
