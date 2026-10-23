const wrap=value=>((value%1)+1)%1;

// A shared loop makes backward scrubbing and the midnight boundary repeatable.
// Larger nearby sprites travel farther per loop, retaining a depth cue.
export const cloudPhase=({cloudPosition=0,cloudSync=false,time=0})=>wrap(cloudPosition/100+(cloudSync?time/1440:0));
export const cloudOffset=(phase,time,synced)=>wrap(phase-(synced?time/1440:0))*100;
export const cloudDriftRate=(speed,style='cumulus')=>speed>0?(.00028+speed*.00002)*(['cumulus','soft'].includes(style)?1:.5):0;
