import { element, by } from "detox";
import {
    expectToMatchScreenshot,
    launchApp,
    sessionLogout,
    setText,
    tapMenuItem
} from "../../../../../detox/src/helpers";

describe("Gallery", () => {
    beforeEach(async () => {
        await launchApp();
        await tapMenuItem("Gallery");
        await element(by.id("galleryTextFilterButton")).tap();
    });

    afterEach(async () => {
        await sessionLogout();
    });

    it("renders correctly", async () => {
        const gallery = element(by.id("gallery"));
        await expectToMatchScreenshot(gallery);
    });

    it("filters by text", async () => {
        const gallery = element(by.id("gallery"));
        const filterTextBox = element(by.id("textFilter1-text-input"));
        await setText(filterTextBox, "Title 5");
        await expectToMatchScreenshot(gallery);
    });

    it("filters by text empty list", async () => {
        const gallery = element(by.id("gallery"));
        const filterTextBox = element(by.id("textFilter1-text-input"));
        await setText(filterTextBox, "Title 100");
        await expectToMatchScreenshot(gallery);
    });
});
