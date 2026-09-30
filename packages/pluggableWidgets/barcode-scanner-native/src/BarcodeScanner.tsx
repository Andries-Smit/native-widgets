import { flattenStyles } from "@mendix/piw-native-utils-internal";
import { ValueStatus } from "mendix";
import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, LayoutChangeEvent, Platform } from "react-native";
import { Camera, useCameraDevice } from "react-native-vision-camera";
import { useBarcodeScannerOutput, Barcode, TargetBarcodeFormat } from "react-native-vision-camera-barcode-scanner";
import BarcodeMask from "./components/BarcodeMask";

import { BarcodeScannerProps } from "../typings/BarcodeScannerProps";
import { BarcodeScannerStyle, defaultBarcodeScannerStyle } from "./ui/styles";
import { executeAction } from "@mendix/piw-utils-internal";

export type Props = BarcodeScannerProps<BarcodeScannerStyle>;

type CodePositionInfo = {
    isWithinMask: boolean;
    distanceToMaskCenterSquared: number;
    overlapArea: number;
    overlapPercentage: number;
};

type TransformedCoordinates = {
    codeX: number;
    codeY: number;
    codeWidth: number;
    codeHeight: number;
};

type OverlapInfo = {
    overlapArea: number;
    overlapPercentage: number;
};

type CandidateCode = {
    code: Barcode;
    isWithinMask: boolean;
    distanceToMaskCenterSquared: number;
    overlapArea: number;
    overlapPercentage: number;
};

type ScanFrame = {
    width: number;
    height: number;
};

const BARCODE_FORMATS: TargetBarcodeFormat[] = [
    "qr-code",
    "aztec",
    "codabar",
    "code-39",
    "code-93",
    "code-128",
    "data-matrix",
    "ean-13",
    "ean-8",
    "upc-a",
    "upc-e",
    "pdf-417",
    "itf"
];

/**
 * Transforms barcode coordinates from camera sensor space to screen view space.
 * Handles platform-specific coordinate systems (iOS sensor landscape vs Android ML Kit rotated)
 * and applies appropriate scaling based on device orientation.
 */
function transformCodeCoordinates(
    codeFrame: { x: number; y: number; width: number; height: number },
    scanFrame: ScanFrame,
    viewWidth: number,
    viewHeight: number
): TransformedCoordinates {
    const { width: frameWidth, height: frameHeight } = scanFrame;
    const isPortrait = viewHeight > viewWidth;

    let codeX: number;
    let codeY: number;
    let codeWidth: number;
    let codeHeight: number;

    if (isPortrait && Platform.OS === "ios") {
        // iOS: code.frame coordinates are in the sensor's native landscape space,
        // so we need a 90° rotation to map to portrait view coordinates.
        const scaleX = viewWidth / frameHeight;
        const scaleY = viewHeight / frameWidth;

        codeX = (frameHeight - codeFrame.y - codeFrame.height) * scaleX;
        codeY = codeFrame.x * scaleY;
        codeWidth = codeFrame.height * scaleX;
        codeHeight = codeFrame.width * scaleY;
    } else if (isPortrait && Platform.OS === "android") {
        // Android: ML Kit already rotates code.frame coordinates to match device orientation,
        // but CodeScannerFrame still reports sensor landscape dimensions (e.g. 1920x1080).
        // Scale using the shorter dimension for X and longer for Y.
        const scaleX = viewWidth / Math.min(frameWidth, frameHeight);
        const scaleY = viewHeight / Math.max(frameWidth, frameHeight);

        codeX = codeFrame.x * scaleX;
        codeY = codeFrame.y * scaleY;
        codeWidth = codeFrame.width * scaleX;
        codeHeight = codeFrame.height * scaleY;
    } else {
        const scaleX = viewWidth / frameWidth;
        const scaleY = viewHeight / frameHeight;

        codeX = codeFrame.x * scaleX;
        codeY = codeFrame.y * scaleY;
        codeWidth = codeFrame.width * scaleX;
        codeHeight = codeFrame.height * scaleY;
    }

    return { codeX, codeY, codeWidth, codeHeight };
}

/**
 * Calculates the overlap between a barcode and the mask region.
 * Returns both the absolute overlap area and the percentage of the barcode that overlaps with the mask.
 */
function calculateOverlap(
    codeX: number,
    codeY: number,
    codeWidth: number,
    codeHeight: number,
    maskX: number,
    maskY: number,
    maskWidth: number,
    maskHeight: number
): OverlapInfo {
    const overlapLeft = Math.max(codeX, maskX);
    const overlapTop = Math.max(codeY, maskY);
    const overlapRight = Math.min(codeX + codeWidth, maskX + maskWidth);
    const overlapBottom = Math.min(codeY + codeHeight, maskY + maskHeight);

    const overlapWidth = Math.max(0, overlapRight - overlapLeft);
    const overlapHeight = Math.max(0, overlapBottom - overlapTop);

    const overlapArea = overlapWidth * overlapHeight;
    const barcodeArea = codeWidth * codeHeight;
    const overlapPercentage = barcodeArea > 0 ? overlapArea / barcodeArea : 0;

    return { overlapArea, overlapPercentage };
}

/**
 * Comparator function to select the best barcode when multiple codes are detected.
 * Priority: overlap percentage > overlap area > distance to mask center (squared).
 */
function compareCodesByPriority(a: CandidateCode, b: CandidateCode): number {
    if (b.overlapPercentage !== a.overlapPercentage) {
        return b.overlapPercentage - a.overlapPercentage;
    }

    if (b.overlapArea !== a.overlapArea) {
        return b.overlapArea - a.overlapArea;
    }

    return a.distanceToMaskCenterSquared - b.distanceToMaskCenterSquared;
}

export function BarcodeScanner(props: Props): ReactElement {
    const device = useCameraDevice("back");

    const styles = useMemo(() => flattenStyles(defaultBarcodeScannerStyle, props.style), [props.style]);

    // Ref to track the lock state
    const isLockedRef = useRef(false);

    const [cameraViewDimensions, setCameraViewDimensions] = useState<{ width: number; height: number } | null>(null);

    const maskWidth = styles.mask.width || 280;
    const maskHeight = styles.mask.height || 260;

    const getCodePositionInfo = useCallback(
        (code: Barcode, scanFrame: ScanFrame | undefined): CodePositionInfo => {
            if (!props.showMask) {
                return {
                    isWithinMask: true,
                    distanceToMaskCenterSquared: 0,
                    overlapArea: Number.MAX_SAFE_INTEGER,
                    overlapPercentage: 1
                };
            }

            if (!cameraViewDimensions || !scanFrame) {
                return {
                    isWithinMask: false,
                    distanceToMaskCenterSquared: Number.MAX_SAFE_INTEGER,
                    overlapArea: 0,
                    overlapPercentage: 0
                };
            }

            const { left, top, right, bottom } = code.boundingBox;
            const codeFrame = { x: left, y: top, width: right - left, height: bottom - top };

            const { width: viewWidth, height: viewHeight } = cameraViewDimensions;

            // Barcode mask coordinates in view space
            const maskX = (viewWidth - maskWidth) / 2;
            const maskY = (viewHeight - maskHeight) / 2;
            const maskCenterX = maskX + maskWidth / 2;
            const maskCenterY = maskY + maskHeight / 2;

            // Transform Qr barcode coordinates from camera sensor space to view space
            const { codeX, codeY, codeWidth, codeHeight } = transformCodeCoordinates(
                codeFrame,
                scanFrame,
                viewWidth,
                viewHeight
            );

            const codeCenterX = codeX + codeWidth / 2;
            const codeCenterY = codeY + codeHeight / 2;

            const distanceToMaskCenterSquared =
                Math.pow(codeCenterX - maskCenterX, 2) + Math.pow(codeCenterY - maskCenterY, 2);

            const { overlapArea, overlapPercentage } = calculateOverlap(
                codeX,
                codeY,
                codeWidth,
                codeHeight,
                maskX,
                maskY,
                maskWidth,
                maskHeight
            );

            const isWithinMask =
                codeCenterX >= maskX &&
                codeCenterX <= maskX + maskWidth &&
                codeCenterY >= maskY &&
                codeCenterY <= maskY + maskHeight;

            return {
                isWithinMask,
                distanceToMaskCenterSquared,
                overlapArea,
                overlapPercentage
            };
        },
        [props.showMask, cameraViewDimensions, maskWidth, maskHeight]
    );

    // The barcode scanner output's currentResolution is a live property (not passed
    // to onBarcodeScanned), so we read it from the scannerOutput ref on every scan.
    const scannerOutputRef = useRef<ReturnType<typeof useBarcodeScannerOutput> | undefined>(undefined);

    const onBarcodeScanned = useCallback(
        (codes: Barcode[]) => {
            // Block if still in cooldown
            if (isLockedRef.current) {
                return;
            }

            if (props.barcode.status !== ValueStatus.Available || codes.length === 0) {
                return;
            }

            const scanFrame = scannerOutputRef.current?.currentResolution;

            const candidates = codes
                .map(code => {
                    const positionInfo = getCodePositionInfo(code, scanFrame);
                    return {
                        code,
                        ...positionInfo
                    };
                })
                .filter(item => item.isWithinMask);

            if (candidates.length === 0) {
                return;
            }

            const selectedCode = candidates.sort(compareCodesByPriority)[0].code;

            if (!selectedCode.rawValue) {
                return;
            }

            const { rawValue: value } = selectedCode;

            if (value !== props.barcode.value) {
                props.barcode.setValue(value);
            }

            executeAction(props.onDetect);

            // Lock further scans for 2 seconds
            isLockedRef.current = true;
            setTimeout(() => {
                isLockedRef.current = false;
            }, 2000);
        },
        [props.barcode, props.onDetect, getCodePositionInfo]
    );

    const scannerOutput = useBarcodeScannerOutput({
        barcodeFormats: BARCODE_FORMATS,
        onBarcodeScanned,
        onError: error => console.warn("BarcodeScanner: failed to scan barcodes", error)
    });
    useEffect(() => {
        scannerOutputRef.current = scannerOutput;
    }, [scannerOutput]);

    const handleCameraLayout = useCallback((event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        setCameraViewDimensions({ width, height });
    }, []);

    return (
        <View style={styles.container}>
            {device && (
                <>
                    <Camera
                        nativeID={props.name}
                        style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
                        isActive
                        device={device}
                        outputs={[scannerOutput]}
                        onLayout={handleCameraLayout}
                    />
                    {props.showMask && (
                        <BarcodeMask
                            edgeColor={styles.mask.color}
                            width={maskWidth}
                            height={maskHeight}
                            backgroundColor={styles.mask.backgroundColor}
                            showAnimatedLine={props.showAnimatedLine}
                        />
                    )}
                </>
            )}
        </View>
    );
}
