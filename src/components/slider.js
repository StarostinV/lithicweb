import noUiSlider from 'nouislider';

export default class Slider {
    constructor(id, start, min, max, callback) {
        const sliderId = "slider" + id;
        this.slider = document.getElementById(sliderId);
        this.value = document.getElementById(sliderId + 'Value');
        this.label = document.getElementById(sliderId + 'Label');
        this.callback = callback;

        noUiSlider.create(this.slider, {
            start: [start],
            range: {
                'min': [min],
                'max': [max]
            }
        });

        this.slider.noUiSlider.on('update',  (values, handle) => {
            this.value.innerHTML = values[handle];
            if (this.callback) {
                this.callback(values[handle]);
            }
        });
    }

    hide() {
        this.slider.style.display = 'none';
        this.value.style.display = 'none';
        this.label.style.display = 'none';
    }

    show() {
        this.slider.style.display = '';
        this.value.style.display = '';
        this.label.style.display = '';
    }
}