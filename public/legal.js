try {
  const response=await fetch('/api/public-info',{cache:'no-store'});
  if(response.ok) {
    const info=await response.json();
    const name=typeof info.operatorName==='string' ? info.operatorName : 'This app’s operator';
    if(info.operatorContact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.operatorContact)) {
      const contact=document.getElementById('operator-contact');
      const notice=document.getElementById('operator-info');
      if(contact) {
        contact.textContent=`For app-access or data questions, contact ${name}: `;
        const link=document.createElement('a');link.href=`mailto:${info.operatorContact}`;link.textContent=info.operatorContact;contact.append(link);
      }
      if(notice) notice.textContent=`${name} has configured an operator contact. This is a private pilot; public release remains blocked pending release review and final disclosures.`;
    }
  }
} catch { /* Static disclosures remain useful if the server is unavailable. */ }
