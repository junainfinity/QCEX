package com.qcex.identity;

import com.qcex.ledger.Ledger;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

@Service
public class Identity {
    private final JdbcTemplate db;
    private final Ledger ledger;
    private final TransactionTemplate tx;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder(12);
    private final SecureRandom random = new SecureRandom();
    public Identity(JdbcTemplate db, Ledger ledger, TransactionTemplate tx) { this.db=db;this.ledger=ledger;this.tx=tx; }
    public static String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
    public void throttle(String key) {
        boolean allowed = Boolean.TRUE.equals(tx.execute(status -> {
            ledger.lock(); String digest=hash(key);
            db.update("DELETE FROM auth_attempts WHERE reset_at<CURRENT_TIMESTAMP(6)");
            db.update("INSERT INTO auth_attempts(identity_key,attempts,reset_at) VALUES (?,1,DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL 1 MINUTE)) ON DUPLICATE KEY UPDATE attempts=attempts+1",digest);
            return db.queryForObject("SELECT attempts FROM auth_attempts WHERE identity_key=?", Integer.class,digest)<=10;
        }));
        if (!allowed) throw new TooManyAttempts();
    }
    public Map<String,String> authenticate(String handle,String password,boolean register) {
        if (handle==null || !handle.matches("[a-zA-Z0-9_]{3,24}") || password==null || password.length()<10 || password.getBytes(StandardCharsets.UTF_8).length>72)
            throw new IllegalArgumentException("Use a 3–24 character username and a password of 10–72 bytes");
        String normalized=handle.toLowerCase(Locale.ROOT);
        String encoded = register ? passwords.encode(password) : "";
        return tx.execute(status -> {
            ledger.lock();
            var users=db.queryForList("SELECT * FROM users WHERE handle=?",normalized);
            String id;
            if (register) {
                if (!users.isEmpty()) throw new IllegalArgumentException("Username unavailable");
                id=UUID.randomUUID().toString();
                db.update("INSERT INTO users(id,handle,password_hash) VALUES (?,?,?)",id,normalized,encoded);
                Map.of("USDT","100000","BTC","0.5","ETH","5","SOL","100").forEach((a,v)->ledger.fund(id,a,new BigDecimal(v)));
            } else {
                if (users.isEmpty() || !passwords.matches(password,(String)users.getFirst().get("password_hash"))) throw new Unauthorized();
                id=(String)users.getFirst().get("id");
            }
            byte[] bytes=new byte[32]; random.nextBytes(bytes); String token=HexFormat.of().formatHex(bytes);
            db.update("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)",hash(token),id,Timestamp.from(Instant.now().plusSeconds(28800)));
            return Map.of("id",id,"handle",normalized,"token",token);
        });
    }
    public String require(String token) {
        if(token==null || !token.matches("[a-f0-9]{64}")) throw new Unauthorized();
        var rows=db.queryForList("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>CURRENT_TIMESTAMP(6)",hash(token));
        if(rows.isEmpty()) throw new Unauthorized();
        return (String)rows.getFirst().get("user_id");
    }
    public void logout(String token) { if(token!=null) db.update("DELETE FROM sessions WHERE token_hash=?",hash(token)); }
    public static class Unauthorized extends RuntimeException {}
    public static class TooManyAttempts extends RuntimeException {}
}
