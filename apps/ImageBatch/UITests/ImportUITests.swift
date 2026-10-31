import XCTest

final class ImportUITests: XCTestCase {
    func testImportValidationAndDuplicatePreview() {
        let app = XCUIApplication()
        app.launch()
        app.buttons["new-download"].tap()
        let editor = app.textViews["import-text"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        editor.tap(); editor.typeText("https://example.com/one.jpg\nhttps://example.com/two.png\nhttps://example.com/one.jpg")
        XCTAssertTrue(app.staticTexts["2 张图片"].exists)
        XCTAssertTrue(app.staticTexts["已忽略 1 条重复链接"].exists)
        XCTAssertTrue(app.buttons["import-start"].isEnabled)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "import-preview"; attachment.lifetime = .keepAlways; add(attachment)
        app.buttons["取消"].tap()
        app.buttons["new-download"].tap()
        editor.tap(); editor.typeText("file:///etc/passwd")
        XCTAssertTrue(app.staticTexts["import-error"].exists)
        XCTAssertFalse(app.buttons["import-start"].isEnabled)
    }
}
