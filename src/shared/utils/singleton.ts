/**
 * A generic singleton base class that can be extended by any class
 * Assumes the extending class has a private constructor with no parameters
 */
export abstract class Singleton<T extends Singleton<T>> {
    private static instances = new Map<any, any>();

    /**
     * Get the singleton instance of the class
     * Creates the instance if it doesn't exist
     */
    public static getInstance(this: any) {
        const constructor = this;

        if (!Singleton.instances.has(constructor)) {
            // Create new instance using the constructor
            // This works because we're calling from within the class hierarchy
            const instance = new constructor();
            Singleton.instances.set(constructor, instance);
        }

        return Singleton.instances.get(constructor);
    }

    /**
     * Protected constructor to prevent direct instantiation
     * Subclasses should make their constructors private and call super()
     */
    protected constructor() {
        // Prevent direct instantiation of the base class
        if (new.target === Singleton) {
            throw new Error('Cannot instantiate Singleton base class directly');
        }
    }
}