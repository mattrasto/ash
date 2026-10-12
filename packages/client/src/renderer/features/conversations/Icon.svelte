<script lang="ts">
  let {name,size=18}:{name:'new'|'sidebar'|'archive'|'restore'|'more'|'send'|'stop'|'attach'|'copy'|'inspect'|'retry'|'close';size?:number}=$props();
  const paths={new:'M12 5v14M5 12h14',sidebar:'M4 4h16v16H4zM9 4v16',archive:'M4 4h16v4H4zM6 8v12h12V8M10 12h4',restore:'M5 10v10h14V10M8 7l4-4 4 4M12 3v11',more:'M5 12h.01M12 12h.01M19 12h.01',send:'M12 19V5M6 11l6-6 6 6',stop:'M7 7h10v10H7z',attach:'m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8',copy:'M9 9h11v11H9zM15 5V3H3v12h2',inspect:'M10 10h4M12 14v3M12 6v.01M3 3h18v18H3z',retry:'M4 10a8 8 0 1 1 1 8M4 4v6h6',close:'m6 6 12 12M6 18 18 6'};
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>
