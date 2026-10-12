import sharp from 'sharp';
export async function screenshotFixture(label='IMAGE CHECK') {
  return sharp(Buffer.from(`<svg width="960" height="640" xmlns="http://www.w3.org/2000/svg"><rect width="960" height="640" fill="#f3f5ec"/><rect x="48" y="48" width="864" height="544" rx="20" fill="white" stroke="#ced9c2"/><text x="92" y="125" font-family="sans-serif" font-size="38" fill="#344b2b">${label}</text><rect x="92" y="178" width="250" height="230" rx="10" fill="#e7bc43"/><circle cx="584" cy="291" r="108" fill="#4e78b3"/><text x="92" y="485" font-family="sans-serif" font-size="25" fill="#344b2b">Yellow rectangle · blue circle</text><text x="92" y="538" font-family="sans-serif" font-size="20" fill="#7c8b70">Synthetic screenshot for image verification</text></svg>`)).png().toBuffer();
}
export async function orientedFixture() {return sharp({create:{width:120,height:80,channels:3,background:'#be8844'}}).jpeg().withMetadata({orientation:6}).toBuffer();}
