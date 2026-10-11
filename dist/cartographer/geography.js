/* WGS84 / UTM zone 11N, metre coordinates. Host geography, not semantic core. */
'use strict';
function utm11(lon,lat){
 const a=6378137,e2=0.0066943799901413165,ep=e2/(1-e2),k=.9996,r=Math.PI/180,phi=lat*r,lambda=(lon+117)*r;
 const sin=Math.sin(phi),cos=Math.cos(phi),tan=Math.tan(phi),N=a/Math.sqrt(1-e2*sin*sin),T=tan*tan,C=ep*cos*cos,A=cos*lambda;
 const M=a*((1-e2/4-3*e2**2/64-5*e2**3/256)*phi-(3*e2/8+3*e2**2/32+45*e2**3/1024)*Math.sin(2*phi)+(15*e2**2/256+45*e2**3/1024)*Math.sin(4*phi)-35*e2**3/3072*Math.sin(6*phi));
 return {e:500000+k*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep)*A**5/120),n:k*(M+N*tan*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep)*A**6/720))};
}
