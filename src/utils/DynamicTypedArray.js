class DynamicTypedArray {
    constructor(initialSize = 1000, TypedArrayConstructor = Uint32Array) {
        this.array = new TypedArrayConstructor(initialSize);
        this.size = 0;
    }

    push(value) {
        if (this.size >= this.array.length) {
            const newArray = new this.array.constructor(this.array.length * 2);
            newArray.set(this.array);
            this.array = newArray;
        }
        this.array[this.size++] = value;
    }

    getUsedPortion() {
        return new this.array.constructor(this.array.buffer, 0, this.size);
    }
}

export default DynamicTypedArray;