namespace ChiefOfStaff.Core.Models;

public class Person
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string? Role { get; set; }
    public string? Email { get; set; }

    /// <summary>1 (low) to 5 (highest). Requests from higher-weight people rank higher.</summary>
    public int PriorityWeight { get; set; } = 3;

    public string Initials =>
        string.Concat(Name.Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(2).Select(p => char.ToUpperInvariant(p[0])));
}
