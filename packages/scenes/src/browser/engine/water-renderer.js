import {waterPhase,waterArtworkRect} from './water.js';

const vertex=`attribute vec2 position;varying vec2 uv;
void main(){uv=position*.5+.5;gl_Position=vec4(position.x,-position.y,0.,1.);}`;
const fragment=`precision highp float;
varying vec2 uv;
uniform sampler2D artwork,waterMap,clouds;
uniform vec2 resolution,cropOrigin,cropSize;
uniform vec3 skyTop,skyMiddle,skyBottom;
uniform float horizon,phase,ripples,reflections,hasClouds;
float luma(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
void main(){
  vec3 water=texture2D(waterMap,uv).rgb;
  if(water.r<.001||water.b<.99){gl_FragColor=vec4(0.);return;}
  vec2 pixel=cropOrigin+uv*cropSize,p=pixel/resolution;
  float near=water.g;
  // Perspective compresses the horizontal ripples toward the far bank. Their
  // phase varies across the lake, avoiding a single rigid wobble of every row.
  float v=log(1.+max(0.,p.y-horizon)*10.)*180.;
  float t=phase*6.2831853;
  float swell=sin(v+p.x*19.+sin(p.x*11.)-t*3.);
  float fine=sin(v*1.79-p.x*37.+t*5.);
  float cross=sin(v*.57+p.x*63.-t*2.);
  float envelope=.65+.35*sin(p.x*21.+v*.07);
  vec2 wave=vec2(swell*.68+fine*.22,cross*.23+fine*.12)*envelope;
  float strength=ripples*water.r*(.24+.76*near)*resolution.x/1024.;
  // Vertical displacement crosses the painted horizontal water marks, making
  // continuous ripples legible instead of sliding along nearly identical color.
  vec2 offset=wave*vec2(3.4,3.2)*strength/cropSize;
  vec2 sourceUV=clamp(uv+offset,vec2(0.),vec2(1.));
  // Reject a displaced sample that would pull trees, bank, or unknown pixels
  // into water. The final interior mask also keeps all non-water pixels intact.
  float safe=step(.99,texture2D(waterMap,sourceUV).b);
  sourceUV=mix(uv,sourceUV,safe);
  vec3 original=texture2D(artwork,uv).rgb;
  vec3 painted=texture2D(artwork,sourceUV).rgb;
  vec2 skyUV=vec2(p.x,clamp(2.*horizon-p.y,0.,horizon));
  skyUV+=wave*vec2(.004,.009)*ripples*water.r*(.3+.7*near);
  skyUV=clamp(skyUV,vec2(0.),vec2(1.,horizon));
  float height=clamp(skyUV.y/max(.1,horizon),0.,1.);
  vec3 sky=height<.5?mix(skyTop,skyMiddle,smoothstep(0.,.5,height)):mix(skyMiddle,skyBottom,smoothstep(.5,1.,height));
  vec4 cloud=texture2D(clouds,vec2(skyUV.x,skyUV.y/max(.1,horizon)));
  vec3 environment=mix(sky,cloud.rgb,cloud.a*hasClouds)*.90;
  // Shallow viewing angles reflect more sky. Preserve dark painted reflections
  // rather than washing every part of the lake with the same sky color.
  float fresnel=.45+.55*pow(1.-near,2.);
  float detail=.45+.55*smoothstep(luma(sky)*.35,luma(sky)*.85,luma(original));
  float blend=reflections*.62*fresnel*detail;
  vec2 texel=vec2(2.)/cropSize;
  vec3 local=(texture2D(artwork,clamp(uv+vec2(texel.x,0.),0.,1.)).rgb+texture2D(artwork,clamp(uv-vec2(texel.x,0.),0.,1.)).rgb+texture2D(artwork,clamp(uv+vec2(0.,texel.y),0.,1.)).rgb+texture2D(artwork,clamp(uv-vec2(0.,texel.y),0.,1.)).rgb)*.25;
  // Restore source-scale pigment grain after blending a smooth sky reflection.
  vec3 color=mix(painted,environment,blend)+(original-local)*blend*.8;
  gl_FragColor=vec4(clamp(color,0.,1.),water.r);
}`;

export class WaterRenderer{
  constructor(){
    this.canvas=document.createElement('canvas');
    const gl=this.canvas.getContext('webgl',{alpha:true,antialias:false,premultipliedAlpha:false,depth:false,stencil:false});
    if(!gl)throw new Error('Water effects need WebGL. The painted water is retained.');
    this.gl=gl;
    const compile=(type,code)=>{const shader=gl.createShader(type);gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);gl.getExtension('WEBGL_lose_context')?.loseContext();throw new Error(error);}return shader;};
    const program=gl.createProgram(),vs=compile(gl.VERTEX_SHADER,vertex),fs=compile(gl.FRAGMENT_SHADER,fragment);
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const message=gl.getProgramInfoLog(program);gl.deleteProgram(program);gl.getExtension('WEBGL_lose_context')?.loseContext();throw new Error(message);}
    this.program=program;gl.useProgram(program);
    const buffer=gl.createBuffer();this.buffer=buffer;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const attribute=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
    this.uniforms=Object.fromEntries(['resolution','cropOrigin','cropSize','horizon','phase','ripples','reflections','hasClouds','skyTop','skyMiddle','skyBottom'].map(name=>[name,gl.getUniformLocation(program,name)]));
    this.textures=['artwork','waterMap','clouds'].map((name,i)=>{
      const texture=gl.createTexture();gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));gl.uniform1i(gl.getUniformLocation(program,name),i);return texture;
    });
    this.textureSizes=[[1,1],[1,1],[1,1]];
    this.base=document.createElement('canvas');this.baseContext=this.base.getContext('2d');
    this.contextLost=e=>{e.preventDefault();this.failed=true;this.onFailure?.();};
    this.canvas.addEventListener('webglcontextlost',this.contextLost);
  }
  dispose(){
    if(this.disposed)return;this.disposed=true;this.failed=true;this.onFailure=null;this.canvas.removeEventListener('webglcontextlost',this.contextLost);
    const gl=this.gl;for(const texture of this.textures)gl.deleteTexture(texture);gl.deleteBuffer(this.buffer);gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.width=this.canvas.height=this.base.width=this.base.height=0;this.geometry=null;this.textures=[];this.baseContext=null;this.baseSources=null;this.gl=null;
  }
  load(geometry){
    this.geometry=geometry;this.baseKey=null;this.baseSources=null;if(!geometry)return;
    const {width,height,pixels}=geometry;this.canvas.width=this.base.width=width;this.canvas.height=this.base.height=height;
    const gl=this.gl;gl.viewport(0,0,width,height);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,this.textures[1]);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    if(gl.getError()!==gl.NO_ERROR)throw new Error('Water texture could not be uploaded.');
  }
  upload(unit,image){
    const gl=this.gl,size=this.textureSizes[unit];gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,this.textures[unit]);
    if(size[0]===image.width&&size[1]===image.height)gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,image);
    else{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);this.textureSizes[unit]=[image.width,image.height];}
  }
  draw(frames,base,clouds,settings,index,mix,palette,horizon){
    if(this.failed||!this.geometry)return null;
    const g=this.geometry,gl=this.gl,u=this.uniforms;
    const key=[index,mix,settings.daylight,settings.lift].join(':');
    const sources=[frames[index],frames[index+1],base];
    if(key!==this.baseKey||sources.some((image,i)=>image!==this.baseSources?.[i])){
      const c=this.baseContext,draw=image=>{const crop=waterArtworkRect(g,image.width,image.height);c.drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,g.width,g.height);};
      c.globalAlpha=1;draw(frames[index]);c.globalAlpha=mix;draw(frames[index+1]);c.globalAlpha=1-settings.daylight/100;draw(base);c.globalAlpha=1;
      this.upload(0,this.base);this.baseKey=key;this.baseSources=sources;
    }
    if(clouds&&settings.waterReflections>0)this.upload(2,clouds);
    gl.uniform2f(u.resolution,g.sourceWidth,g.sourceHeight);gl.uniform2f(u.cropOrigin,g.x,g.y);gl.uniform2f(u.cropSize,g.width,g.height);
    gl.uniform1f(u.horizon,horizon);gl.uniform1f(u.phase,waterPhase(settings));gl.uniform1f(u.ripples,settings.waterStrength/100);gl.uniform1f(u.reflections,settings.waterReflections/100);gl.uniform1f(u.hasClouds,clouds?1:0);
    for(const [i,name]of ['skyTop','skyMiddle','skyBottom'].entries())gl.uniform3fv(u[name],palette[i].map(c=>c/255));
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);return this.canvas;
  }
}
