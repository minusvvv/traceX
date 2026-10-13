const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));

export function complaintSeverity(reports){
  if(reports>=10)return "critical";
  if(reports>=5)return "suspicious";
  if(reports>=3)return "review";
  return "safe";
}

export function complaintIntensityColor(reports){
  const n=Math.max(1,reports);
  const hue=n<=2?170-(n-1)*20:n<=4?45-(n-3)*15:n<=9?10-(n-5)*1.5:0;
  const lightness=clamp(43-Math.max(0,n-3)*1.2,30,43);
  return `hsl(${Math.max(0,hue)} 68% ${lightness}%)`;
}

export const complaintSeverityLabel={safe:"Low",review:"Moderate",suspicious:"High",critical:"Critical"};
