package com.qcex.api;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.util.Set;

@Component
public class RequestPolicy extends OncePerRequestFilter {
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws ServletException,IOException {
        response.setHeader("Cache-Control","no-store");response.setHeader("X-Content-Type-Options","nosniff");
        String origin=request.getHeader("Origin");
        if(!Set.of("GET","HEAD","OPTIONS").contains(request.getMethod()) && origin!=null && !Set.of("http://127.0.0.1:3100","http://localhost:3100").contains(origin)) {
            response.setStatus(403);response.setContentType("application/json");response.getWriter().write("{\"error\":\"Cross-site request denied\"}");return;
        }
        if(request.getContentLengthLong()>32768){response.sendError(413);return;}
        chain.doFilter(request,response);
    }
}
