// Small non-invasive patch for current prototype.
// Keeps existing app intact while changing the admin testing PIN to 7900.
function patchPoolsideAdmin(){
  const code=document.getElementById('adminCode');
  const btn=document.getElementById('adminLogin');
  if(!code||!btn||btn.dataset.pin7900)return;
  btn.dataset.pin7900='1';
  const note=btn.parentElement?.querySelector('.muted');
  if(note) note.textContent='Prototype passcode: 7900.';
  btn.onclick=function(e){
    if(code.value==='7900'){
      try{
        const keys=['poolside-pulse-state-v3','poolside-pulse-state-v2','poolside-pulse-state-v1'];
        const key=keys.find(k=>localStorage.getItem(k))||keys[0];
        const state=JSON.parse(localStorage.getItem(key)||'{}');
        state.admin=true;
        state.events=[{type:'admin',text:'Admin logged in',time:new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})},...(state.events||[])].slice(0,60);
        localStorage.setItem(key,JSON.stringify(state));
      }catch{}
      location.reload();
    }else alert('Wrong passcode');
  };
}
setInterval(patchPoolsideAdmin,500);
patchPoolsideAdmin();
