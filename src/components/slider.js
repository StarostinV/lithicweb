import noUiSlider from 'nouislider';

export default class Slider {
    constructor(id, valueId, start, min, max, callback) {
        this.slider = document.getElementById(id);
        this.value = document.getElementById(valueId);
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
}