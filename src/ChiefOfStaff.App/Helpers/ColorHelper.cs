using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;

namespace ChiefOfStaff.App.Helpers;

public static class ColorHelper
{
    public static Color FromHex(string? hex, Color fallback = default)
    {
        if (string.IsNullOrWhiteSpace(hex)) return fallback;
        var h = hex.TrimStart('#');
        if (h.Length != 6 || !uint.TryParse(h, System.Globalization.NumberStyles.HexNumber, null, out var v)) return fallback;
        return Color.FromArgb(0xFF, (byte)(v >> 16), (byte)(v >> 8), (byte)v);
    }

    public static SolidColorBrush Brush(string? hex) => new(FromHex(hex, Colors.Gray));

    /// <summary>Translucent tint of the color, readable in light and dark themes.</summary>
    public static SolidColorBrush Tint(string? hex, byte alpha = 0x40)
    {
        var c = FromHex(hex, Colors.Gray);
        return new SolidColorBrush(Color.FromArgb(alpha, c.R, c.G, c.B));
    }

    public static Brush ThemeBrush(string key) =>
        Application.Current.Resources.TryGetValue(key, out var value) && value is Brush b
            ? b
            : new SolidColorBrush(Colors.Transparent);

    /// <summary>Background/foreground for the 0-100 priority badge.</summary>
    public static (Brush Background, Brush Foreground) ScoreBrushes(int score) => score switch
    {
        >= 80 => (ThemeBrush("SystemFillColorCriticalBackgroundBrush"), ThemeBrush("SystemFillColorCriticalBrush")),
        >= 60 => (ThemeBrush("SystemFillColorCautionBackgroundBrush"), ThemeBrush("SystemFillColorCautionBrush")),
        _ => (ThemeBrush("SubtleFillColorSecondaryBrush"), ThemeBrush("TextFillColorSecondaryBrush")),
    };
}
