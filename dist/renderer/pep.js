/* global Audio, document */
// Global button click sound effect
(function () {
  var audio = new Audio('assets/pep.mp3');
  audio.volume = 0.5;

  document.addEventListener(
    'click',
    function (e) {
      var target = e.target;
      while (target && target !== document.body) {
        var tag = target.tagName;
        if (
          tag === 'BUTTON' ||
          tag === 'A' ||
          (tag === 'INPUT' && (target.type === 'checkbox' || target.type === 'radio')) ||
          (tag === 'LABEL' &&
            target.querySelector('input[type="checkbox"], input[type="radio"]')) ||
          target.role === 'button' ||
          target.classList.contains('toolbar-btn') ||
          target.classList.contains('permission-btn') ||
          target.classList.contains('prereq-install-btn') ||
          target.classList.contains('color-swatch') ||
          target.classList.contains('playback-btn') ||
          target.classList.contains('continue-btn') ||
          target.classList.contains('modal-close') ||
          target.classList.contains('modal-save') ||
          target.classList.contains('back-btn') ||
          target.classList.contains('close-btn') ||
          target.classList.contains('footer-link') ||
          target.classList.contains('step-dot') ||
          target.dataset.clickSound !== undefined
        ) {
          // Clone so overlapping clicks each produce sound
          var clone = audio.cloneNode();
          clone.volume = audio.volume;
          clone.play().catch(function () {});
          return;
        }
        target = target.parentElement;
      }
    },
    true,
  );
})();
