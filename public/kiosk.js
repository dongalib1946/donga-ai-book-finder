(function(){
  'use strict';

  function disableOutboundLinks(root){
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('a[href]').forEach((link)=>{
      link.dataset.kioskHref = link.getAttribute('href') || '';
      link.removeAttribute('href');
      link.removeAttribute('target');
      link.removeAttribute('rel');
      link.setAttribute('aria-disabled', 'true');
      if(!link.getAttribute('role')) link.setAttribute('role', 'presentation');
    });
  }

  function pulseQuestionLoader(){
    document.body.classList.add('question-step-loading');
    window.clearTimeout(pulseQuestionLoader.timer);
    pulseQuestionLoader.timer = window.setTimeout(()=>{
      document.body.classList.remove('question-step-loading');
    }, 720);
  }

  function blockQuestionInput(event){
    if(!document.body.classList.contains('question-step-loading')) return;
    if(!event.target.closest || !event.target.closest('#quizView')) return;
    event.preventDefault();
    event.stopPropagation();
  }

  document.addEventListener('DOMContentLoaded', ()=>{
    document.body.classList.add('kiosk-page');
    disableOutboundLinks(document);

    const choices = document.getElementById('choices');
    if(choices){
      choices.addEventListener('click', (event)=>{
        if(event.target.closest('button.choice')) pulseQuestionLoader();
      }, true);
    }

    ['click', 'pointerdown', 'touchstart', 'keydown'].forEach((eventName)=>{
      document.addEventListener(eventName, blockQuestionInput, true);
    });

    document.addEventListener('click', (event)=>{
      const link = event.target.closest && event.target.closest('a');
      if(link){
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);

    const observer = new MutationObserver((mutations)=>{
      mutations.forEach((mutation)=>{
        mutation.addedNodes.forEach((node)=>{
          if(node.nodeType !== 1) return;
          if(node.matches && node.matches('a[href]')) disableOutboundLinks(node.parentElement || document);
          else disableOutboundLinks(node);
        });
      });
    });

    observer.observe(document.body, { childList:true, subtree:true });
  });
})();
