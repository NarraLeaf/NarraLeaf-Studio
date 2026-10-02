// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { NodeWrapperMotionDriver, nodeWrapperTransform, type NodeWrapperPose } from "./nodeWrapperMotion";

const REST: NodeWrapperPose = { left: 10, top: 20, x: 0, y: 0, scale: 1, rotate: 0, opacity: 0.5 };

function attachedDriver(pose: NodeWrapperPose = REST) {
    const node = document.createElement("div");
    const driver = new NodeWrapperMotionDriver(pose);
    driver.attach(node);
    return { node, driver };
}

describe("nodeWrapperTransform", () => {
    it("writes the identity pose as none, the way motion did", () => {
        expect(nodeWrapperTransform({ x: 0, y: 0, scale: 1, rotate: 0 })).toBe("none");
    });

    it("writes a pose in motion's order and units, leaving out what is at rest", () => {
        expect(nodeWrapperTransform({ x: 24, y: -12, scale: 1, rotate: 0 })).toBe("translateX(24px) translateY(-12px)");
        expect(nodeWrapperTransform({ x: 0, y: 0, scale: 1.25, rotate: 15 })).toBe("scale(1.25) rotate(15deg)");
        expect(nodeWrapperTransform({ x: 5, y: 0, scale: 2, rotate: -30 })).toBe("translateX(5px) scale(2) rotate(-30deg)");
    });
});

describe("NodeWrapperMotionDriver", () => {
    it("writes placement as soon as it is attached and whenever it changes", () => {
        const { node, driver } = attachedDriver();
        expect(node.style.left).toBe("10px");
        expect(node.style.top).toBe("20px");
        driver.set("left", 42);
        expect(node.style.left).toBe("42px");
    });

    it("leaves the transform and opacity to React until it has taken them", () => {
        const { node, driver } = attachedDriver();
        node.style.transform = "rotate(3deg)";
        node.style.opacity = "0.9";
        driver.set("x", 30);
        driver.set("opacity", 0.1);
        expect(node.style.transform).toBe("rotate(3deg)");
        expect(node.style.opacity).toBe("0.9");

        driver.takeTransform();
        driver.takeOpacity();
        expect(node.style.transform).toBe("translateX(30px)");
        expect(node.style.opacity).toBe("0.1");
    });

    it("clamps an opacity outside 0..1 the way motion writes an alpha", () => {
        const { node, driver } = attachedDriver();
        driver.takeOpacity();
        driver.set("opacity", 1.2);
        expect(node.style.opacity).toBe("1");
        driver.set("opacity", -0.3);
        expect(node.style.opacity).toBe("0");
    });

    it("sets a whole target at once, taking opacity when the target names it", () => {
        const { node, driver } = attachedDriver();
        driver.takeTransform();
        driver.setTarget({ x: 4, y: 6, scale: 1, rotate: 0, opacity: 0.3, unknown: 9 });
        expect(node.style.transform).toBe("translateX(4px) translateY(6px)");
        expect(driver.ownsOpacityChannel()).toBe(true);
        expect(node.style.opacity).toBe("0.3");
    });

    it("remembers which channels a motion animated, so their rest values stop following the props", () => {
        const { driver } = attachedDriver();
        void driver.start({ scale: [1, 2] }, { type: "tween", duration: 10 }, false);
        expect(driver.hasMotionAnimated("scale")).toBe(true);
        expect(driver.hasMotionAnimated("rotate")).toBe(false);
        driver.stop();
    });

    it("writes nothing once detached", () => {
        const { node, driver } = attachedDriver();
        driver.attach(null);
        driver.set("left", 99);
        expect(node.style.left).toBe("10px");
    });
});
