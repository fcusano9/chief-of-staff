using System.Text.Json;
using ChiefOfStaff.Core.Models;

namespace ChiefOfStaff.Data.Services;

public class SettingsService(string path)
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public AppSettings Current { get; private set; } = Load(path);

    public void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, JsonSerializer.Serialize(Current, Json));
    }

    private static AppSettings Load(string path)
    {
        try
        {
            return File.Exists(path)
                ? JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(path), Json) ?? new()
                : new();
        }
        catch (JsonException)
        {
            return new();
        }
    }
}
